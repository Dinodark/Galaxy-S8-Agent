const path = require('path');
const fse = require('fs-extra');
const config = require('../config');

function systemTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function effectiveTz() {
  return (config.dailyReview && config.dailyReview.tz) || systemTz();
}

function dirFor(chatId) {
  return path.join(config.paths.memoryDir, 'journal', String(chatId));
}

function fileFor(chatId, dateStr) {
  return path.join(dirFor(chatId), `${dateStr}.jsonl`);
}

function dateInTz(date, tz) {
  // en-CA locale yields YYYY-MM-DD; Intl safely handles DST.
  const opts = { year: 'numeric', month: '2-digit', day: '2-digit' };
  if (tz) opts.timeZone = tz;
  return new Intl.DateTimeFormat('en-CA', opts).format(date);
}

function todayStr(tz) {
  return dateInTz(new Date(), tz || effectiveTz());
}

function shiftDay(dateStr, daysDelta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + daysDelta);
  return dateInTz(dt, 'UTC');
}

async function append(chatId, entry) {
  const dateStr = todayStr();
  const file = fileFor(chatId, dateStr);
  await fse.ensureDir(dirFor(chatId));
  const record = {
    ts: entry.ts || new Date().toISOString(),
    source: entry.source, // 'user' | 'assistant'
    via: entry.via || 'text', // 'text' | 'voice' | 'audio' | 'video_note'
    text: String(entry.text == null ? '' : entry.text),
  };
  await fse.appendFile(file, JSON.stringify(record) + '\n');
}

async function readDay(chatId, dateStr) {
  const file = fileFor(chatId, dateStr);
  if (!(await fse.pathExists(file))) return [];
  const raw = await fse.readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
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
  listDays,
  todayStr,
  shiftDay,
  effectiveTz,
  systemTz,
  dirFor,
  fileFor,
};
