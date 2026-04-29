const path = require('path');
const fse = require('fs-extra');
const config = require('../../config');
const { chatCompletion } = require('../llm');
const tools = require('../tools');
const memory = require('../memory');
const settings = require('../settings');
const { loadProjectsIndex, planWriteOrchestration } = require('../knowledge_orchestrator');
const { logTriageRun } = require('../inbox_triage_log');
const {
  collectWrittenNotesReported,
  countToolsInTranscript,
  verifyWrittenNotesOnDisk,
  summarizeMemoryToolStep,
} = require('../tool_transcript_utils');

const PROMPT_FILE = path.join(__dirname, '..', 'prompts', 'inbox_triage.md');

const TRIAGE_TOOL_NAMES = new Set(['list_notes', 'read_note', 'write_note']);

const INBOX_REL = 'inbox.md';

function withoutInboxArchive(files) {
  return (files || []).filter(
    (f) => !String(f).replace(/\\/g, '/').startsWith('inbox/archive/')
  );
}

const INBOX_SCAFFOLD = `# Inbox

_Пусто. Быстрые захваты до вечерней сводки; после сводки содержимое разбирается в базу знаний, снимок дня лежит в inbox/archive/._
`;

function triageToolSchemas() {
  return tools.listSchemas().filter((s) => TRIAGE_TOOL_NAMES.has(s.function.name));
}

function isInboxAlreadyCleared(body) {
  const t = String(body || '').trim().replace(/\r\n/g, '\n');
  if (!t) return true;
  if (t === INBOX_SCAFFOLD.trim()) return true;
  return false;
}

async function archiveInboxSnapshot(today, body) {
  const archiveDir = path.join(config.paths.notesDir, 'inbox', 'archive');
  await fse.ensureDir(archiveDir);
  const dest = path.join(archiveDir, `${today}-inbox.md`);
  const header = `# Inbox snapshot — ${today}\n\n(перед ночным разбором)\n\n---\n\n`;
  await fse.writeFile(dest, header + body + '\n', 'utf8');
  return path.posix.join('inbox', 'archive', `${today}-inbox.md`);
}

async function clearInboxFile() {
  await memory.writeNote(INBOX_REL, INBOX_SCAFFOLD, { append: false });
}

/**
 * After the evening summary file exists: route inbox body into project notes, trim conflicts, then clear inbox.
 * On failure, or when no write_note succeeded (if clearInboxOnlyAfterWrites): leaves inbox.md unchanged; snapshot under inbox/archive/ still exists for recovery.
 */
async function runInboxTriage({ chatId, today, log = console } = {}) {
  const s = await settings.getSettings();
  const dr = s.dailyReview || {};
  if (dr.inboxTriage === false) {
    const result = { skipped: true, reason: 'inboxTriage disabled' };
    await logTriageRun({ chatId, today, result });
    return result;
  }

  const raw = await memory.readNote(INBOX_REL);
  const inboxBody = raw == null ? '' : String(raw).trim();
  if (isInboxAlreadyCleared(inboxBody)) {
    const result = { skipped: true, reason: 'inbox empty or already cleared' };
    await logTriageRun({ chatId, today, result });
    return result;
  }

  const archiveRel = await archiveInboxSnapshot(today, inboxBody);
  log.log(`[inbox-triage] pre-clear snapshot → ${archiveRel}`);

  let orchestrationHint = '';
  try {
    const files = withoutInboxArchive(await memory.listNotes());
    const index = await loadProjectsIndex();
    const sample =
      inboxBody.length > 12_000
        ? `${inboxBody.slice(0, 12_000)}\n\n…(truncated for routing score)…`
        : inboxBody;
    const plan = planWriteOrchestration(sample, files, index);
    if (plan.systemMessage) orchestrationHint = plan.systemMessage;
  } catch (err) {
    log.warn('[inbox-triage] orchestration hint failed:', err.message);
  }

  const conflictsRaw = await memory.readNote('inbox_conflicts.md');
  const conflictsBody = conflictsRaw == null ? '' : String(conflictsRaw).trim();

  const promptSys = await fse.readFile(PROMPT_FILE, 'utf8');
  const maxSteps = Number(dr.inboxTriageMaxSteps) > 0 ? Number(dr.inboxTriageMaxSteps) : 12;

  const userPayload = [
    `# ДАТА для заголовков в заметках: ${today}`,
    '# INBOX (разложить по существующим путям из list_notes)',
    inboxBody,
    '# inbox_conflicts.md (сократить до открытых пунктов)',
    conflictsBody || '(файла нет — создайте при необходимости)',
    '# Подсказка маршрутизатора (не выдумывайте пути)',
    orchestrationHint || '(нет)',
  ].join('\n\n');

  const modelOverride = dr.model || null;
  const toolCtx = { chatId };
  let messages = [
    { role: 'system', content: promptSys },
    { role: 'user', content: userPayload },
  ];

  const transcript = [];

  try {
    for (let step = 0; step < maxSteps; step++) {
      const { message: assistantMsg } = await chatCompletion({
        messages,
        tools: triageToolSchemas(),
        model: modelOverride,
        timeoutMs: 120_000,
      });

      const pushed = [assistantMsg];

      if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
        for (const call of assistantMsg.tool_calls) {
          const name = call.function && call.function.name;
          let args = {};
          try {
            args =
              call.function && call.function.arguments
                ? JSON.parse(call.function.arguments)
                : {};
          } catch {
            args = {};
          }
          if (!TRIAGE_TOOL_NAMES.has(name)) {
            const bad = { ok: false, error: 'tool not allowed in inbox triage' };
            transcript.push({ tool: name, args, result: bad });
            pushed.push({
              role: 'tool',
              tool_call_id: call.id,
              name,
              content: JSON.stringify(bad),
            });
            continue;
          }
          const result = await tools.execute(name, args, toolCtx);
          transcript.push({ tool: name, args, result });
          pushed.push({
            role: 'tool',
            tool_call_id: call.id,
            name,
            content: JSON.stringify(result).slice(0, 8000),
          });
        }
        messages = [...messages, ...pushed];
        continue;
      }

      messages = [...messages, ...pushed];
      break;
    }

    const writeCount = transcript.filter(
      (t) => t.tool === 'write_note' && t.result && t.result.ok
    ).length;
    const disk = await verifyWrittenNotesOnDisk(
      transcript,
      config.paths.notesDir
    );
    const verificationMismatch =
      writeCount !== disk.verifiedRows ||
      !!(disk.writtenNotesMissing && disk.writtenNotesMissing.length);
    const toolCounts = countToolsInTranscript(transcript);
    const triageSteps = transcript.map((row, i) =>
      summarizeMemoryToolStep(row, i)
    );
    const writtenNotesReported = collectWrittenNotesReported(transcript);

    if (verificationMismatch) {
      log.warn(
        '[inbox-triage] verification mismatch — handler ok vs disk:',
        writeCount,
        'vs',
        disk.verifiedRows,
        disk.writtenNotesMissing || ''
      );
    }

    const requireWrites = dr.clearInboxOnlyAfterWrites !== false;
    const cleared = shouldClearInboxAfterTriage(writeCount, requireWrites);
    if (cleared) {
      await clearInboxFile();
      log.log(
        `[inbox-triage] cleared ${INBOX_REL} (${writeCount} write_note ok, ${disk.verifiedRows} verified on disk, ${transcript.length} tool rows)`
      );
    } else {
      log.warn(
        `[inbox-triage] inbox not cleared — 0 successful write_note (${transcript.length} tool rows); ${INBOX_REL} left as-is; snapshot ${archiveRel}`
      );
    }

    const result = {
      skipped: false,
      cleared,
      archivedRel: archiveRel,
      resolvedNotesDir: config.paths.notesDir,
      writeNoteOk: writeCount,
      writeNoteVerified: disk.verifiedRows,
      toolRows: transcript.length,
      toolCounts,
      triageSteps,
      writtenNotes: disk.writtenNotes,
      writtenNotesReported,
      verificationMismatch,
      ...(disk.writtenNotesMissing
        ? { writtenNotesMissing: disk.writtenNotesMissing }
        : {}),
      ...(cleared ? {} : { reason: 'no_successful_write_note' }),
    };
    await logTriageRun({ chatId, today, result });
    return result;
  } catch (err) {
    log.warn('[inbox-triage] failed — inbox.md not cleared:', err.message);
    const writeCount = transcript.filter(
      (t) => t.tool === 'write_note' && t.result && t.result.ok
    ).length;
    let disk = {
      verifiedRows: 0,
      writtenNotes: [],
      writtenNotesMissing: undefined,
    };
    try {
      disk = await verifyWrittenNotesOnDisk(transcript, config.paths.notesDir);
    } catch {
      /* ignore */
    }
    const verificationMismatch =
      writeCount !== disk.verifiedRows ||
      !!(disk.writtenNotesMissing && disk.writtenNotesMissing.length);
    const triageSteps = transcript.map((row, i) =>
      summarizeMemoryToolStep(row, i)
    );
    const result = {
      skipped: false,
      cleared: false,
      error: err.message,
      archivedRel: archiveRel,
      resolvedNotesDir: config.paths.notesDir,
      writeNoteOk: writeCount,
      writeNoteVerified: disk.verifiedRows,
      toolRows: transcript.length,
      toolCounts: countToolsInTranscript(transcript),
      triageSteps,
      writtenNotes: disk.writtenNotes,
      writtenNotesReported: collectWrittenNotesReported(transcript),
      verificationMismatch,
      ...(disk.writtenNotesMissing
        ? { writtenNotesMissing: disk.writtenNotesMissing }
        : {}),
    };
    await logTriageRun({ chatId, today, result });
    return result;
  }
}

/** When `requireWritesBeforeClear` is false, always clear (legacy). When true, clear only if writeOkCount > 0. */
function shouldClearInboxAfterTriage(writeOkCount, requireWritesBeforeClear) {
  if (requireWritesBeforeClear === false) return true;
  return writeOkCount > 0;
}

module.exports = {
  runInboxTriage,
  triageToolSchemas,
  isInboxAlreadyCleared,
  INBOX_SCAFFOLD,
  shouldClearInboxAfterTriage,
};
