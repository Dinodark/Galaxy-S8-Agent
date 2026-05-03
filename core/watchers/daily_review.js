const path = require('path');
const fse = require('fs-extra');
const { CronExpressionParser } = require('cron-parser');
const config = require('../../config');
const { chatCompletion } = require('../llm');
const journal = require('../journal');
const settings = require('../settings');
const memory = require('../memory');
const { runInboxTriage } = require('./inbox_triage');
const { rebuildAfterNotesChange } = require('../memory_atlas');

const PROMPT_FILE = path.join(__dirname, '..', 'prompts', 'daily_review.md');
const {
  SUMMARY_PREFIX,
  SUMMARY_SUFFIX,
  isSummaryFilename,
  summariesRelForDay,
  legacySummaryRelForDay,
} = require('../notes_paths');

const MAX_JOURNAL_CHARS = 60_000;
const MAX_NOTE_CHARS = 10_000;
const MAX_PREV_SUMMARY_CHARS = 8_000;

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

function formatEntries(entries, tz) {
  return entries
    .map((e) => {
      const when = formatTimestamp(e.ts, tz);
      const who = e.source === 'user' ? 'USER' : 'AGENT';
      const via = e.via && e.via !== 'text' ? ` (${e.via})` : '';
      const text = (e.text || '').replace(/\r\n/g, '\n');
      return `[${when}] ${who}${via}: ${text}`;
    })
    .join('\n');
}

function truncateHead(s, maxChars) {
  if (!s || s.length <= maxChars) return s;
  // Keep the tail — recent stuff matters more.
  return (
    '…(truncated earlier content)…\n' + s.slice(s.length - maxChars)
  );
}

function isSummaryFile(rel) {
  return isSummaryFilename(path.basename(rel));
}

function isInboxArchiveRel(f) {
  return String(f || '')
    .replace(/\\/g, '/')
    .startsWith('inbox/archive/');
}

async function loadLongTermNotes() {
  const dir = config.paths.notesDir;
  await fse.ensureDir(dir);
  const relFiles = (await memory.listNotes())
    .filter((f) => !isSummaryFile(f) && !isInboxArchiveRel(f))
    .sort();
  const parts = [];
  for (const f of relFiles) {
    const content = (await fse.readFile(path.join(dir, f), 'utf8')).trim();
    if (!content) continue;
    parts.push(`## ${f}\n\n${truncateHead(content, MAX_NOTE_CHARS)}`);
  }
  return parts.join('\n\n---\n\n');
}

async function loadInboxExcerpt() {
  const dir = config.paths.notesDir;
  const rel = 'inbox.md';
  const full = path.join(dir, rel);
  if (!(await fse.pathExists(full))) return '';
  const content = (await fse.readFile(full, 'utf8')).trim();
  if (!content) return '';
  return truncateHead(`## ${rel}\n\n${content}`, 6_000);
}

async function loadInboxConflictsExcerpt() {
  const dir = config.paths.notesDir;
  const rel = 'inbox_conflicts.md';
  const full = path.join(dir, rel);
  if (!(await fse.pathExists(full))) return '';
  const content = (await fse.readFile(full, 'utf8')).trim();
  if (!content) return '';
  return truncateHead(`## ${rel}\n\n${content}`, 2_000);
}

async function loadPreviousSummaries(upToN, todayStr) {
  const dir = config.paths.notesDir;
  await fse.ensureDir(dir);
  const all = await memory.listNotes();
  const todayBase = `${SUMMARY_PREFIX}${todayStr}${SUMMARY_SUFFIX}`;
  const files = all
    .filter((rel) => {
      const b = path.basename(rel);
      if (!isSummaryFilename(b)) return false;
      if (b === todayBase) return false;
      return true;
    })
    .sort((a, b) => String(a).localeCompare(String(b)))
    .slice(-upToN);
  const parts = [];
  for (const rel of files) {
    const content = (await fse.readFile(path.join(dir, rel), 'utf8')).trim();
    if (!content) continue;
    parts.push(truncateHead(content, MAX_PREV_SUMMARY_CHARS));
  }
  return parts.join('\n\n---\n\n');
}

async function runReview(chatId, { log = console, force = false } = {}) {
  const s = await settings.getSettings();
  const tz = await journal.effectiveTz();
  const today = journal.todayStr(tz);

  const entries = await journal.readDay(chatId, today);
  if (!force && entries.length < s.dailyReview.minMessages) {
    return {
      skipped: true,
      reason: `only ${entries.length} entries (min ${s.dailyReview.minMessages})`,
      today,
      entries: entries.length,
    };
  }

  const convo = truncateHead(formatEntries(entries, tz), MAX_JOURNAL_CHARS);
  const notes = await loadLongTermNotes();
  const prev = await loadPreviousSummaries(
    s.dailyReview.prevDays,
    today
  );
  const inbox = await loadInboxExcerpt();
  const conflicts = await loadInboxConflictsExcerpt();

  const promptSys = await fse.readFile(PROMPT_FILE, 'utf8');

  const userBlock = [
    `# TODAY (${today}, tz=${tz})`,
    convo || '(no messages logged today)',
    '',
    '# LONG-TERM NOTES',
    notes || '(no long-term notes yet)',
    '',
    '# INBOX (routed/unsorted — consolidate if present)',
    inbox || '(inbox is empty or missing)',
    '',
    '# AMBIGUITY LOG (inbox_conflicts — optional)',
    conflicts || '(no logged conflicts)',
    '',
    '# PREVIOUS SUMMARIES',
    prev || '(no previous daily summaries)',
  ].join('\n');

  const messages = [
    { role: 'system', content: promptSys },
    { role: 'user', content: userBlock },
  ];

  log.log(
    `[daily-review] generating for chat ${chatId} (${entries.length} entries, today=${today})`
  );

  const modelOverride = s.dailyReview.model || null;
  const { message: resp } = await chatCompletion({
    messages,
    model: modelOverride,
    debugContext: { scope: 'daily_review', chatId, today },
  });
  const summary = ((resp && resp.content) || '').trim();
  if (!summary) {
    throw new Error('empty summary from model');
  }

  const rel = summariesRelForDay(today);
  const fname = rel;
  const file = path.join(config.paths.notesDir, rel);
  await fse.ensureDir(path.dirname(file));
  await fse.writeFile(file, summary);

  let triage = { skipped: true, reason: 'not run' };
  try {
    triage = await runInboxTriage({ chatId, today, log });
  } catch (err) {
    log.warn('[daily-review] inbox triage crashed:', err.message);
    triage = { skipped: false, cleared: false, error: err.message };
  }

  await rebuildAfterNotesChange({ chatId }, log);

  return {
    skipped: false,
    today,
    fname,
    file,
    summary,
    entries: entries.length,
    model: modelOverride || config.openrouter.model,
    triage,
  };
}

async function fireForAll(chatIds, onReview, log) {
  for (const chatId of chatIds) {
    try {
      const result = await runReview(chatId, { log });
      if (result.skipped) {
        log.log(`[daily-review] skipped chat ${chatId}: ${result.reason}`);
        continue;
      }
      await onReview(chatId, result);
    } catch (err) {
      log.warn(`[daily-review] failed for chat ${chatId}:`, err.message);
    }
  }
}

async function hasTodaysSummary(todayStr) {
  const dir = config.paths.notesDir;
  const cur = path.join(dir, summariesRelForDay(todayStr));
  const legacy = path.join(dir, legacySummaryRelForDay(todayStr));
  return (await fse.pathExists(cur)) || (await fse.pathExists(legacy));
}

function startDailyReviewer({ chatIds, onReview, log = console }) {
  if (!chatIds || chatIds.length === 0) {
    log.warn('[daily-review] no chat ids provided, scheduler not started');
    return () => {};
  }

  let stopped = false;
  let timer = null;
  let catchupTimer = null;
  let cronExpr = null;
  let tz = null;

  // Catch-up: if the bot just booted AFTER the scheduled fire time for
  // today, and there is no summaries/summary-YYYY-MM-DD.md yet (or legacy root), run a missed
  // review shortly after startup. Prevents losing the day's summary
  // just because the bot was restarted/offline at the cron time.
  async function scheduleCatchupIfMissed() {
    try {
      const today = journal.todayStr(tz);
      if (await hasTodaysSummary(today)) return;

      let prev;
      try {
        prev = CronExpressionParser.parse(cronExpr, {
          currentDate: new Date(),
          tz,
        })
          .prev()
          .toDate();
      } catch {
        return;
      }

      // Only catch up if the most recent scheduled fire was TODAY
      // (don't fire a stale yesterday's summary).
      const prevDateStr = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        timeZone: tz,
      }).format(prev);
      if (prevDateStr !== today) return;

      log.log(
        `[daily-review] missed today's ${prev.toISOString()} fire; running catch-up in 30s`
      );
      catchupTimer = setTimeout(() => {
        fireForAll(chatIds, onReview, log).catch((err) =>
          log.warn('[daily-review] catch-up failed:', err.message)
        );
      }, 30_000);
    } catch (err) {
      log.warn('[daily-review] catch-up scheduling failed:', err.message);
    }
  }

  function schedule() {
    if (stopped) return;
    let next;
    try {
      next = CronExpressionParser.parse(cronExpr, {
        currentDate: new Date(),
        tz,
      })
        .next()
        .toDate();
    } catch (err) {
      log.warn(`[daily-review] bad cron "${cronExpr}":`, err.message);
      return;
    }
    const delay = Math.max(1000, next.getTime() - Date.now());
    log.log(
      `[daily-review] next fire ${next.toISOString()} (tz=${tz}, cron="${cronExpr}")`
    );
    timer = setTimeout(async () => {
      await fireForAll(chatIds, onReview, log);
      schedule();
    }, delay);
  }

  settings
    .getSettings()
    .then((s) => {
      if (stopped) return;
      if (!s.dailyReview.enabled) {
        log.log('[daily-review] disabled via settings');
        return;
      }
      cronExpr = s.dailyReview.cron;
      tz = s.dailyReview.tz || journal.systemTz();
      schedule();
      scheduleCatchupIfMissed();
    })
    .catch((err) => {
      log.warn('[daily-review] failed to load settings:', err.message);
    });

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (catchupTimer) clearTimeout(catchupTimer);
  };
}

module.exports = { runReview, startDailyReviewer };
