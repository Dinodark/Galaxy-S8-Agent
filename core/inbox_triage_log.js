const path = require('path');
const fse = require('fs-extra');
const config = require('../config');

/** Human-auditable lines: one JSON object per run (append-only). Lives under memory/ — same privacy as journal. */
const REL_PATH_IN_MEMORY = path.join('logs', 'inbox_triage.jsonl');

function logPath() {
  return path.join(config.paths.memoryDir, REL_PATH_IN_MEMORY);
}

/**
 * @param {{ chatId?: number|null, today?: string|null, result: Record<string, unknown> }} opts
 */
async function logTriageRun({ chatId, today, result }) {
  const entry = {
    ts: new Date().toISOString(),
    chatId: chatId == null ? null : chatId,
    today: today || null,
    ...result,
  };
  const file = logPath();
  try {
    await fse.ensureDir(path.dirname(file));
    await fse.appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
  } catch (err) {
    console.warn('[inbox-triage-log] append failed:', err.message);
  }
}

/**
 * @param {number} [limit]
 */
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

module.exports = {
  logTriageRun,
  readRecent,
  REL_PATH_IN_MEMORY,
};
