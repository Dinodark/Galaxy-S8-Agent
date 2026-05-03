const path = require('path');
const fse = require('fs-extra');
const { chatCompletion, mergeUsage, emptyUsage } = require('../llm');
const tools = require('../tools');
const memory = require('../memory');
const settings = require('../settings');
const journal = require('../journal');
const config = require('../../config');
const { loadProjectsIndex, planWriteOrchestration } = require('../knowledge_orchestrator');
const { logJournalIngestRun } = require('../journal_ingest_log');
const {
  collectWrittenNotesReported,
  countToolsInTranscript,
  verifyWrittenNotesOnDisk,
} = require('../tool_transcript_utils');
const { rebuildAfterNotesChange } = require('../memory_atlas');

const PROMPT_FILE = path.join(__dirname, '..', 'prompts', 'journal_ingest.md');

const INGEST_TOOL_NAMES = new Set(['list_notes', 'read_note', 'write_note']);

function withoutInboxArchive(files) {
  return (files || []).filter(
    (f) => !String(f).replace(/\\/g, '/').startsWith('inbox/archive/')
  );
}

function formatTimestamp(iso, tz) {
  try {
    return new Date(iso).toLocaleTimeString('ru-RU', {
      hour12: false,
      timeZone: tz,
    });
  } catch {
    return iso;
  }
}

function formatJournalBlock(entries, tz) {
  return entries
    .map((e) => {
      const when = formatTimestamp(e.ts, tz);
      const who = e.source === 'user' ? 'USER' : 'AGENT';
      const via = e.via && e.via !== 'text' ? ` (${e.via})` : '';
      const text = String(e.text == null ? '' : e.text).replace(/\r\n/g, '\n');
      return `[${when}] ${who}${via}: ${text}`;
    })
    .join('\n');
}

function triageToolSchemas() {
  return tools.listSchemas().filter((s) => INGEST_TOOL_NAMES.has(s.function.name));
}

/**
 * LLM pass: distribute one day's journal lines into memory/notes (same tool surface as inbox triage).
 * Triggered manually (e.g. web). Does not delete or modify journal files.
 */
async function runJournalIngest({ chatId, day, log = console } = {}) {
  const dayStr = String(day || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayStr)) {
    const err = new Error('invalid day (expected YYYY-MM-DD)');
    await logJournalIngestRun({
      chatId,
      day: dayStr,
      result: { skipped: true, reason: 'invalid_day', error: err.message },
    });
    throw err;
  }

  const entries = await journal.readDay(chatId, dayStr);
  if (!entries.length) {
    const result = { skipped: true, reason: 'empty_day' };
    await logJournalIngestRun({ chatId, day: dayStr, result });
    return result;
  }

  const tz = await journal.effectiveTz();
  const bodyText = formatJournalBlock(entries, tz);

  let orchestrationHint = '';
  try {
    const files = withoutInboxArchive(await memory.listNotes());
    const index = await loadProjectsIndex();
    const sample =
      bodyText.length > 12_000
        ? `${bodyText.slice(0, 12_000)}\n\n…(truncated for routing score)…`
        : bodyText;
    const plan = planWriteOrchestration(sample, files, index);
    if (plan.systemMessage) orchestrationHint = plan.systemMessage;
  } catch (err) {
    log.warn('[journal-ingest] orchestration hint failed:', err.message);
  }

  const s = await settings.getSettings();
  const dr = s.dailyReview || {};
  const maxSteps =
    Number(dr.journalIngestMaxSteps) > 0 ? Number(dr.journalIngestMaxSteps) : 12;
  const modelOverride = dr.model || null;

  const promptSys = await fse.readFile(PROMPT_FILE, 'utf8');
  const userPayload = [
    `# ДЕНЬ ЖУРНАЛА: ${dayStr} (tz=${tz})`,
    '# ЛОГ TELEGRAM (USER / AGENT за этот календарный день)',
    bodyText,
    '# Подсказка маршрутизатора (не выдумывайте пути)',
    orchestrationHint || '(нет)',
  ].join('\n\n');

  const toolCtx = { chatId };
  let messages = [
    { role: 'system', content: promptSys },
    { role: 'user', content: userPayload },
  ];

  const transcript = [];
  let usageTotal = emptyUsage();

  try {
    for (let step = 0; step < maxSteps; step++) {
      const { message: assistantMsg, usage } = await chatCompletion({
        messages,
        tools: triageToolSchemas(),
        model: modelOverride,
        timeoutMs: 120_000,
        debugContext: { scope: 'journal_ingest', chatId, today: dayStr },
      });
      mergeUsage(usageTotal, usage);

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
          if (!INGEST_TOOL_NAMES.has(name)) {
            const bad = { ok: false, error: 'tool not allowed in journal ingest' };
            transcript.push({ tool: name, args, result: bad });
            pushed.push({
              role: 'tool',
              tool_call_id: call.id,
              name,
              content: JSON.stringify(bad),
            });
            continue;
          }
          const execResult = await tools.execute(name, args, toolCtx);
          transcript.push({ tool: name, args, result: execResult });
          pushed.push({
            role: 'tool',
            tool_call_id: call.id,
            name,
            content: JSON.stringify(execResult).slice(0, 8000),
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
    const writtenNotesReported = collectWrittenNotesReported(transcript);
    const disk = await verifyWrittenNotesOnDisk(transcript, config.paths.notesDir);
    const verificationMismatch =
      writeCount !== disk.verifiedRows || (disk.writtenNotesMissing && disk.writtenNotesMissing.length > 0);

    const result = {
      skipped: false,
      day: dayStr,
      resolvedNotesDir: config.paths.notesDir,
      toolCounts: countToolsInTranscript(transcript),
      /** Successful write_note executions (handler returned ok — before disk check). */
      writeNoteOk: writeCount,
      /** write_note rows where the file exists under resolvedNotesDir after the run. */
      writeNoteVerified: disk.verifiedRows,
      toolRows: transcript.length,
      entryCount: entries.length,
      /** Deduped paths that exist as files (use this for inventory). */
      writtenNotes: disk.writtenNotes,
      writtenNotesReported,
      verificationMismatch,
      ...(disk.writtenNotesMissing ? { writtenNotesMissing: disk.writtenNotesMissing } : {}),
      usage: usageTotal,
    };
    await logJournalIngestRun({ chatId, day: dayStr, result });
    log.log(
      `[journal-ingest] day=${dayStr} (write_note ok=${writeCount}, verified on disk=${disk.verifiedRows}, ${transcript.length} tool rows)`
    );
    if (verificationMismatch) {
      log.warn(
        '[journal-ingest] verification mismatch — tool ok vs disk:',
        writeCount,
        'vs',
        disk.verifiedRows,
        disk.writtenNotesMissing || ''
      );
    }
    await rebuildAfterNotesChange({ chatId }, log);
    return result;
  } catch (err) {
    log.warn('[journal-ingest] failed:', err.message);
    const writeCount = transcript.filter(
      (t) => t.tool === 'write_note' && t.result && t.result.ok
    ).length;
    let disk = { verifiedRows: 0, writtenNotes: [], writtenNotesMissing: undefined };
    try {
      disk = await verifyWrittenNotesOnDisk(transcript, config.paths.notesDir);
    } catch {
      /* ignore */
    }
    const writtenNotesReported = collectWrittenNotesReported(transcript);
    const result = {
      skipped: false,
      day: dayStr,
      resolvedNotesDir: config.paths.notesDir,
      toolCounts: countToolsInTranscript(transcript),
      error: err.message,
      writeNoteOk: writeCount,
      writeNoteVerified: disk.verifiedRows,
      toolRows: transcript.length,
      entryCount: entries.length,
      writtenNotes: disk.writtenNotes,
      writtenNotesReported,
      verificationMismatch:
        writeCount !== disk.verifiedRows || !!(disk.writtenNotesMissing && disk.writtenNotesMissing.length),
      ...(disk.writtenNotesMissing ? { writtenNotesMissing: disk.writtenNotesMissing } : {}),
      usage: usageTotal,
    };
    await logJournalIngestRun({ chatId, day: dayStr, result });
    throw err;
  }
}

module.exports = {
  runJournalIngest,
  formatJournalBlock,
};
