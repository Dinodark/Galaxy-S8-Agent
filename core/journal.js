const path = require('path');
const crypto = require('crypto');
const fse = require('fs-extra');
const config = require('../config');
const settings = require('./settings');

function systemTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

async function effectiveTz() {
  return (await settings.get('dailyReview.tz')) || systemTz();
}

function dirFor(chatId) {
  return path.join(config.paths.memoryDir, 'journal', String(chatId));
}

function fileFor(chatId, dateStr) {
  return path.join(dirFor(chatId), `${dateStr}.jsonl`);
}

function excludedFileFor(chatId, dateStr) {
  return path.join(dirFor(chatId), `${dateStr}.excluded.json`);
}

function dateInTz(date, tz) {
  // en-CA locale yields YYYY-MM-DD; Intl safely handles DST.
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat('en-CA', opts).format(date);
}

function todayStr(tz) {
  return dateInTz(
    new Date(),
    tz || (config.dailyReview && config.dailyReview.tz) || systemTz()
  );
}

function shiftDay(dateStr, daysDelta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + daysDelta);
  return dateInTz(dt, 'UTC');
}

async function append(chatId, entry) {
  const dateStr = todayStr(await effectiveTz());
  const file = fileFor(chatId, dateStr);
  await fse.ensureDir(dirFor(chatId));
  const record = {
    id: entry.id || `j_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    ts: entry.ts || new Date().toISOString(),
    source: entry.source, // 'user' | 'assistant'
    via: entry.via || 'text', // 'text' | 'voice' | 'audio' | 'video_note'
    text: String(entry.text == null ? '' : entry.text),
  };
  await fse.appendFile(file, JSON.stringify(record) + '\n');
}

function fallbackEntryId(e, i) {
  const seed = `${e.ts || ''}|${e.source || ''}|${e.via || ''}|${e.text || ''}|${i}`;
  return `legacy_${crypto.createHash('sha1').update(seed).digest('hex').slice(0, 16)}`;
}

async function readExcluded(chatId, dateStr) {
  const file = excludedFileFor(chatId, dateStr);
  if (!(await fse.pathExists(file))) return new Set();
  try {
    const data = await fse.readJson(file);
    const ids = Array.isArray(data && data.ids) ? data.ids : [];
    return new Set(ids.map((x) => String(x)).filter(Boolean));
  } catch {
    return new Set();
  }
}

async function writeExcluded(chatId, dateStr, idsSet) {
  const file = excludedFileFor(chatId, dateStr);
  const ids = [...idsSet].map(String).filter(Boolean).sort();
  await fse.ensureDir(dirFor(chatId));
  await fse.writeJson(
    file,
    {
      updatedAt: new Date().toISOString(),
      ids,
    },
    { spaces: 2 }
  );
}

async function readDay(chatId, dateStr, { includeExcluded = false } = {}) {
  const file = fileFor(chatId, dateStr);
  if (!(await fse.pathExists(file))) return [];
  const raw = await fse.readFile(file, 'utf8');
  const excluded = await readExcluded(chatId, dateStr);
  const rows = raw
    .split('\n')
    .filter(Boolean)
    .map((line, i) => {
      try {
        const e = JSON.parse(line);
        if (!e || typeof e !== 'object') return null;
        const id = String(e.id || fallbackEntryId(e, i));
        const row = { ...e, id, excluded: excluded.has(id) };
        return row;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (includeExcluded) return rows;
  return rows.filter((e) => !e.excluded);
}

async function setExcluded(chatId, dateStr, entryId, excluded) {
  const id = String(entryId || '').trim();
  if (!id) throw new Error('entry id is required');
  const set = await readExcluded(chatId, dateStr);
  if (excluded) set.add(id);
  else set.delete(id);
  await writeExcluded(chatId, dateStr, set);
}

async function listDays(chatId) {
  const dir = dirFor(chatId);
  if (!(await fse.pathExists(dir))) return [];
  const files = await fse.readdir(dir);
  return files
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => f.replace(/\.jsonl$/, ''))
    .sort();
}

module.exports = {
  append,
  readDay,
  readExcluded,
  setExcluded,
  listDays,
  todayStr,
  shiftDay,
  effectiveTz,
  systemTz,
  dirFor,
  fileFor,
  excludedFileFor,
};
