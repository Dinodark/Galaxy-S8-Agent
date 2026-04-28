const path = require('path');
const fse = require('fs-extra');
const config = require('../config');

const REL_PATH_IN_MEMORY = path.join('logs', 'journal_ingest.jsonl');

function logPath() {
  return path.join(config.paths.memoryDir, REL_PATH_IN_MEMORY);
}

async function logJournalIngestRun({ chatId, day, result }) {
  const entry = {
    ts: new Date().toISOString(),
    chatId: chatId == null ? null : chatId,
    day: day || null,
    ...result,
  };
  try {
    await fse.ensureDir(path.dirname(logPath()));
    await fse.appendFile(logPath(), JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn('[journal-ingest-log] append failed:', err.message);
  }
}

async function readRecent(limit = 80) {
  const cap = Math.min(Math.max(Number(limit) || 80, 1), 500);
  const file = logPath();
  if (!(await fse.pathExists(file))) return { path: REL_PATH_IN_MEMORY, entries: [] };

  let raw = await fse.readFile(file, 'utf8');
  if (raw.length > 800_000) {
    raw = raw.slice(raw.length - 750_000);
    const nl = raw.indexOf('\n');
    if (nl >= 0) raw = raw.slice(nl + 1);
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(-cap);
  const entries = [];
  for (const line of slice) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      entries.push({ parseError: true, raw: line.slice(0, 200) });
    }
  }
  return { path: REL_PATH_IN_MEMORY, entries };
}

/**
 * Последняя запись в логе для календарного дня журнала (для UI «уже обработан»).
 * Игнорируем только попытки с невалидной датой.
 */
async function lastIngestForDay(dayStr) {
  const normalized = String(dayStr || '').trim();
  if (!normalized) return null;

  const file = logPath();
  if (!(await fse.pathExists(file))) return null;

  let raw = await fse.readFile(file, 'utf8');
  if (raw.length > 2_000_000) {
    raw = raw.slice(raw.length - 1_500_000);
    const nl = raw.indexOf('\n');
    if (nl >= 0) raw = raw.slice(nl + 1);
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  let latest = null;
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e.parseError) continue;
    if (String(e.day || '') !== normalized) continue;
    if (e.skipped && e.reason === 'invalid_day') continue;
    if (!e.ts) continue;
    if (!latest || new Date(e.ts) > new Date(latest.ts)) latest = e;
  }
  return latest;
}

module.exports = {
  logJournalIngestRun,
  readRecent,
  lastIngestForDay,
  REL_PATH_IN_MEMORY,
};
