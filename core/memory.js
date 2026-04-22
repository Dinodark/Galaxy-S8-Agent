const path = require('path');
const fse = require('fs-extra');
const config = require('../config');

const historyCache = new Map();

function historyFile(chatId) {
  return path.join(config.paths.historyDir, `${chatId}.json`);
}

async function loadHistory(chatId) {
  if (historyCache.has(chatId)) return historyCache.get(chatId);
  const file = historyFile(chatId);
  let messages = [];
  if (await fse.pathExists(file)) {
    try {
      messages = await fse.readJson(file);
    } catch {
      messages = [];
    }
  }
  historyCache.set(chatId, messages);
  return messages;
}

async function saveHistory(chatId, messages) {
  await fse.ensureDir(config.paths.historyDir);
  await fse.writeJson(historyFile(chatId), messages, { spaces: 2 });
  historyCache.set(chatId, messages);
}

async function appendToHistory(chatId, newMessages) {
  const history = await loadHistory(chatId);
  history.push(...newMessages);
  // Keep a sliding window but ALWAYS preserve a leading system message if present.
  const limit = config.agent.historyWindow;
  if (history.length > limit) {
    const head = history[0] && history[0].role === 'system' ? [history[0]] : [];
    const tail = history.slice(-Math.max(limit - head.length, 1));
    const trimmed = [...head, ...tail];
    await saveHistory(chatId, trimmed);
    return trimmed;
  }
  await saveHistory(chatId, history);
  return history;
}

async function resetHistory(chatId) {
  historyCache.delete(chatId);
  const file = historyFile(chatId);
  if (await fse.pathExists(file)) await fse.remove(file);
}

async function listNotes() {
  await fse.ensureDir(config.paths.notesDir);
  const files = await fse.readdir(config.paths.notesDir);
  return files.filter((f) => f.endsWith('.md'));
}

async function readNote(name) {
  const safe = sanitizeName(name);
  const file = path.join(config.paths.notesDir, safe);
  if (!(await fse.pathExists(file))) return null;
  return fse.readFile(file, 'utf8');
}

async function writeNote(name, content, { append = false } = {}) {
  await fse.ensureDir(config.paths.notesDir);
  const safe = sanitizeName(name);
  const file = path.join(config.paths.notesDir, safe);
  if (append) {
    await fse.appendFile(file, content.endsWith('\n') ? content : content + '\n');
  } else {
    await fse.writeFile(file, content);
  }
  return safe;
}

function sanitizeName(name) {
  let n = String(name || '').trim().replace(/[^a-zA-Z0-9._-]+/g, '_');
  if (!n) n = 'note';
  if (!n.endsWith('.md')) n += '.md';
  return n;
}

module.exports = {
  loadHistory,
  saveHistory,
  appendToHistory,
  resetHistory,
  listNotes,
  readNote,
  writeNote,
};
