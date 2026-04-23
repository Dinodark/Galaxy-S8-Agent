const path = require('path');
const fse = require('fs-extra');
const config = require('../config');

const FILE = path.join(config.paths.memoryDir, 'modes.json');
const VALID_MODES = new Set(['chat', 'silent']);
const DEFAULT_MODE = 'chat';

let cache = null;

async function load() {
  if (cache) return cache;
  if (await fse.pathExists(FILE)) {
    try {
      cache = JSON.parse(await fse.readFile(FILE, 'utf8'));
    } catch {
      cache = {};
    }
  } else {
    cache = {};
  }
  if (!cache.chatIds || typeof cache.chatIds !== 'object') cache.chatIds = {};
  return cache;
}

async function persist() {
  if (!cache) return;
  await fse.ensureDir(config.paths.memoryDir);
  await fse.writeFile(FILE, JSON.stringify(cache, null, 2));
}

async function getMode(chatId) {
  await load();
  const entry = cache.chatIds[String(chatId)];
  return (entry && entry.mode) || DEFAULT_MODE;
}

async function setMode(chatId, mode) {
  if (!VALID_MODES.has(mode)) {
    throw new Error(`unknown mode: ${mode}`);
  }
  await load();
  cache.chatIds[String(chatId)] = {
    mode,
    since: new Date().toISOString(),
  };
  await persist();
  return mode;
}

module.exports = { getMode, setMode, DEFAULT_MODE, VALID_MODES };
