const path = require('path');
const fse = require('fs-extra');
const { CronExpressionParser } = require('cron-parser');
const config = require('../../config');
const { chatCompletion } = require('../llm');
const journal = require('../journal');

const PROMPT_FILE = path.join(__dirname, '..', 'prompts', 'daily_review.md');
const SUMMARY_PREFIX = 'summary-';
const SUMMARY_SUFFIX = '.md';

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

async function loadLongTermNotes() {
  const dir = config.paths.notesDir;
  await fse.ensureDir(dir);
  const files = (await fse.readdir(dir))
    .filter((f) => f.endsWith('.md'))
    .filter((f) => !f.startsWith(SUMMARY_PREFIX))
    .sort();
  const parts = [];
  for (const f of files) {
    const content = (await fse.readFile(path.join(dir, f), 'utf8')).trim();
    if (!content) continue;
    parts.push(`## ${f}\n\n${truncateHead(content, MAX_NOTE_CHARS)}`);
  }
  return parts.join('\n\n---\n\n');
}

async function loadPreviousSummaries(upToN, todayStr) {
  const dir = config.paths.notesDir;
  await fse.ensureDir(dir);
  const files = (await fse.readdir(dir))
    .filter(
      (f) =>
        f.startsWith(SUMMARY_PREFIX) &&
        f.endsWith(SUMMARY_SUFFIX) &&
        !f.includes(todayStr)
    )
    .sort()
    .slice(-upToN);
  const parts = [];
  for (const f of files) {
    const content = (await fse.readFile(path.join(dir, f), 'utf8')).trim();
    if (!content) continue;
    parts.push(truncateHead(content, MAX_PREV_SUMMARY_CHARS));
  }
  return parts.join('\n\n---\n\n');
}

async function runReview(chatId, { log = console, force = false } = {}) {
  const tz = journal.effectiveTz();
  const today = journal.todayStr(tz);

  const entries = await journal.readDay(chatId, today);
  if (!force && entries.length < config.dailyReview.minMessages) {
    return {
      skipped: true,
      reason: `only ${entries.length} entries (min ${config.dailyReview.minMessages})`,
      today,
      entries: entries.length,
    };
  }

  const convo = truncateHead(formatEntries(entries, tz), MAX_JOURNAL_CHARS);
  const notes = await loadLongTermNotes();
  const prev = await loadPreviousSummaries(
    config.dailyReview.prevDays,
    today
  );

  const promptSys = await fse.readFile(PROMPT_FILE, 'utf8');

  const userBlock = [
    `# TODAY (${today}, tz=${tz})`,
    convo || '(no messages logged today)',
    '',
    '# LONG-TERM NOTES',
    notes || '(no long-term notes yet)',
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

  const modelOverride = config.dailyReview.model || null;
  const resp = await chatCompletion({
    messages,
    model: modelOverride,
  });
  const summary = ((resp && resp.content) || '').trim();
  if (!summary) {
    throw new Error('empty summary from model');
  }

  const fname = `${SUMMARY_PREFIX}${today}${SUMMARY_SUFFIX}`;
  const file = path.join(config.paths.notesDir, fname);
  await fse.ensureDir(config.paths.notesDir);
  await fse.writeFile(file, summary);

  return {
    skipped: false,
    today,
    fname,
    file,
    summary,
    entries: entries.length,
    model: modelOverride || config.openrouter.model,
  };
}

function startDailyReviewer({ chatIds, onReview, log = console }) {
  if (!config.dailyReview.enabled) {
    log.log('[daily-review] disabled via DAILY_REVIEW_ENABLED=false');
    return () => {};
  }
  if (!chatIds || chatIds.length === 0) {
    log.warn('[daily-review] no chat ids provided, scheduler not started');
    return () => {};
  }

  const cronExpr = config.dailyReview.cron;
  const tz = config.dailyReview.tz || journal.systemTz();

  let stopped = false;
  let timer = null;

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
      for (const chatId of chatIds) {
        try {
          const result = await runReview(chatId, { log });
          if (result.skipped) {
            log.log(
              `[daily-review] skipped chat ${chatId}: ${result.reason}`
            );
            continue;
          }
          await onReview(chatId, result);
        } catch (err) {
          log.warn(
            `[daily-review] failed for chat ${chatId}:`,
            err.message
          );
        }
      }
      schedule();
    }, delay);
  }

  schedule();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

module.exports = { runReview, startDailyReviewer };
