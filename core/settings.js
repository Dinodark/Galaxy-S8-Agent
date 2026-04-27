const path = require('path');
const crypto = require('crypto');
const fse = require('fs-extra');
const { CronExpressionParser } = require('cron-parser');
const config = require('../config');

const SETTINGS_FILE = path.join(config.paths.memoryDir, 'settings.json');
const AUDIT_FILE = path.join(config.paths.memoryDir, 'settings_audit.jsonl');

let overridesCache = null;
let saveChain = Promise.resolve();

function defaults() {
  return {
    stt: {
      enabled: config.stt.enabled,
      language: config.stt.language,
      maxDurationSec: config.stt.maxDurationSec,
    },
    dailyReview: {
      enabled: config.dailyReview.enabled,
      cron: config.dailyReview.cron,
      tz: config.dailyReview.tz,
      minMessages: config.dailyReview.minMessages,
      prevDays: config.dailyReview.prevDays,
      model: config.dailyReview.model,
      inboxTriage: config.dailyReview.inboxTriage,
      inboxTriageMaxSteps: config.dailyReview.inboxTriageMaxSteps,
    },
    silent: {
      reaction: '✍',
      autoExitOnDailyReview: true,
    },
    web: {
      enabled: true,
      host: '0.0.0.0',
      port: 8787,
      token: '',
    },
    chats: {},
    knowledge: {
      orchestrator: true,
    },
  };
}

function isPlainObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function mergeDeep(base, override) {
  const out = clone(base);
  for (const [key, value] of Object.entries(override || {})) {
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = mergeDeep(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function splitPath(settingPath) {
  if (!settingPath || typeof settingPath !== 'string') {
    throw new Error('setting path must be a non-empty string');
  }
  return settingPath.split('.').filter(Boolean);
}

function getAt(obj, settingPath) {
  let cur = obj;
  for (const part of splitPath(settingPath)) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function setAt(obj, settingPath, value) {
  const parts = splitPath(settingPath);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const part = parts[i];
    if (!isPlainObject(cur[part])) cur[part] = {};
    cur = cur[part];
  }
  cur[parts[parts.length - 1]] = value;
}

function deleteAt(obj, settingPath) {
  const parts = splitPath(settingPath);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    cur = cur && cur[parts[i]];
    if (!isPlainObject(cur)) return;
  }
  delete cur[parts[parts.length - 1]];
}

async function loadOverrides() {
  if (overridesCache) return overridesCache;
  if (!(await fse.pathExists(SETTINGS_FILE))) {
    overridesCache = {};
    return overridesCache;
  }
  try {
    overridesCache = await fse.readJson(SETTINGS_FILE);
    if (!isPlainObject(overridesCache)) overridesCache = {};
  } catch {
    overridesCache = {};
  }
  return overridesCache;
}

function persistOverrides() {
  saveChain = saveChain.then(async () => {
    await fse.ensureDir(path.dirname(SETTINGS_FILE));
    const tmp = `${SETTINGS_FILE}.tmp`;
    await fse.writeJson(tmp, overridesCache || {}, { spaces: 2 });
    await fse.move(tmp, SETTINGS_FILE, { overwrite: true });
  });
  return saveChain;
}

async function audit(record) {
  await fse.ensureDir(path.dirname(AUDIT_FILE));
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    ...record,
  });
  await fse.appendFile(AUDIT_FILE, `${line}\n`);
}

function validateTimezone(tz) {
  if (tz === '') return '';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
  } catch {
    throw new Error(`Invalid timezone "${tz}". Use an IANA name like Europe/Moscow.`);
  }
  return tz;
}

function validateCron(cron, tz = '') {
  try {
    CronExpressionParser.parse(cron, {
      currentDate: new Date(),
      tz: tz || undefined,
    });
  } catch (err) {
    throw new Error(`Invalid cron "${cron}": ${err.message}`);
  }
  return cron;
}

function parseBool(value) {
  if (typeof value === 'boolean') return value;
  const v = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'вкл', 'да'].includes(v)) return true;
  if (['0', 'false', 'no', 'off', 'выкл', 'нет'].includes(v)) return false;
  throw new Error(`Invalid boolean "${value}". Use true/false.`);
}

function parseIntInRange(value, min, max, name) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return n;
}

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function normalizeReviewTime(value) {
  const raw = String(value).trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) {
    throw new Error('Review time must be HH:MM, e.g. 22:30.');
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error('Review time must be a valid 24-hour HH:MM value.');
  }
  return `${minute} ${hour} * * *`;
}

function validatePathValue(settingPath, value, mergedSettings) {
  if (settingPath === 'stt.enabled') return parseBool(value);
  if (settingPath === 'stt.language') return String(value || '').trim();
  if (settingPath === 'stt.maxDurationSec') {
    return parseIntInRange(value, 1, 3600, 'stt.maxDurationSec');
  }

  if (settingPath === 'dailyReview.enabled') return parseBool(value);
  if (settingPath === 'dailyReview.cron') {
    return validateCron(
      String(value).trim(),
      getAt(mergedSettings, 'dailyReview.tz') || ''
    );
  }
  if (settingPath === 'dailyReview.tz') {
    const tz = validateTimezone(String(value || '').trim());
    validateCron(getAt(mergedSettings, 'dailyReview.cron'), tz);
    return tz;
  }
  if (settingPath === 'dailyReview.minMessages') {
    return parseIntInRange(value, 1, 1000, 'dailyReview.minMessages');
  }
  if (settingPath === 'dailyReview.prevDays') {
    return parseIntInRange(value, 0, 30, 'dailyReview.prevDays');
  }
  if (settingPath === 'dailyReview.model') return String(value || '').trim();
  if (settingPath === 'dailyReview.inboxTriage') return parseBool(value);
  if (settingPath === 'dailyReview.inboxTriageMaxSteps') {
    return parseIntInRange(value, 1, 32, 'dailyReview.inboxTriageMaxSteps');
  }

  if (settingPath === 'silent.reaction') {
    const emoji = String(value || '').trim();
    if (!emoji) throw new Error('silent.reaction cannot be empty.');
    return emoji;
  }
  if (settingPath === 'silent.autoExitOnDailyReview') return parseBool(value);

  if (settingPath === 'web.enabled') return parseBool(value);
  if (settingPath === 'web.host') {
    const host = String(value || '').trim();
    if (!host) throw new Error('web.host cannot be empty.');
    return host;
  }
  if (settingPath === 'web.port') {
    return parseIntInRange(value, 1024, 65535, 'web.port');
  }
  if (settingPath === 'web.token') {
    const token = String(value || '').trim();
    if (token.length < 16) {
      throw new Error('web.token must be at least 16 characters.');
    }
    return token;
  }

  if (settingPath === 'knowledge.orchestrator') return parseBool(value);

  const modeMatch = settingPath.match(/^chats\.(-?\d+)\.mode$/);
  if (modeMatch) {
    const mode = String(value || '').trim();
    if (!['chat', 'silent'].includes(mode)) {
      throw new Error('chat mode must be "chat" or "silent".');
    }
    return mode;
  }

  const sinceMatch = settingPath.match(/^chats\.(-?\d+)\.since$/);
  if (sinceMatch) return String(value || '').trim();

  throw new Error(`Unknown or unsupported setting path: ${settingPath}`);
}

function aliasToPath(alias, rawValue) {
  const key = String(alias || '').trim().toLowerCase();
  const map = {
    daily_review_enabled: 'dailyReview.enabled',
    daily_review_cron: 'dailyReview.cron',
    daily_review_tz: 'dailyReview.tz',
    daily_review_min_messages: 'dailyReview.minMessages',
    daily_review_prev_days: 'dailyReview.prevDays',
    daily_review_model: 'dailyReview.model',
    daily_review_inbox_triage: 'dailyReview.inboxTriage',
    daily_review_inbox_triage_max_steps: 'dailyReview.inboxTriageMaxSteps',
    stt_enabled: 'stt.enabled',
    stt_language: 'stt.language',
    stt_max_duration_sec: 'stt.maxDurationSec',
    silent_reaction: 'silent.reaction',
    silent_auto_exit: 'silent.autoExitOnDailyReview',
    web_enabled: 'web.enabled',
    web_host: 'web.host',
    web_port: 'web.port',
    web_token: 'web.token',
    knowledge_orchestrator: 'knowledge.orchestrator',
  };
  if (key === 'daily_review_time' || key === 'review_time') {
    return { path: 'dailyReview.cron', value: normalizeReviewTime(rawValue) };
  }
  if (!map[key]) {
    throw new Error(`Unknown setting "${alias}".`);
  }
  return { path: map[key], value: rawValue };
}

async function getSettings() {
  const overrides = await loadOverrides();
  const merged = mergeDeep(defaults(), overrides);
  if (!merged.web.token) {
    merged.web.token = generateToken();
    setAt(overrides, 'web.token', merged.web.token);
    overridesCache = overrides;
    await persistOverrides();
    await audit({
      action: 'set',
      actor: { type: 'settings-auto' },
      path: 'web.token',
      before: '',
      after: '[generated]',
    });
  }
  return merged;
}

async function get(settingPath) {
  return getAt(await getSettings(), settingPath);
}

async function has(settingPath) {
  return getAt(await loadOverrides(), settingPath) !== undefined;
}

async function set(settingPath, value, actor = {}) {
  const overrides = await loadOverrides();
  const beforeSettings = await getSettings();
  const normalized = validatePathValue(settingPath, value, beforeSettings);
  const before = getAt(beforeSettings, settingPath);
  setAt(overrides, settingPath, normalized);
  overridesCache = overrides;
  await persistOverrides();
  await audit({
    action: 'set',
    actor,
    path: settingPath,
    before,
    after: normalized,
  });
  return normalized;
}

async function setAlias(alias, rawValue, actor = {}) {
  const resolved = aliasToPath(alias, rawValue);
  return set(resolved.path, resolved.value, actor);
}

async function reset(settingPath, actor = {}) {
  const overrides = await loadOverrides();
  const before = getAt(await getSettings(), settingPath);
  deleteAt(overrides, settingPath);
  overridesCache = overrides;
  await persistOverrides();
  const after = getAt(await getSettings(), settingPath);
  await audit({ action: 'reset', actor, path: settingPath, before, after });
  return after;
}

async function getChatMode(chatId) {
  return (await get(`chats.${chatId}.mode`)) || 'chat';
}

async function setChatMode(chatId, mode, actor = {}) {
  await set(`chats.${chatId}.mode`, mode, actor);
  await set(`chats.${chatId}.since`, new Date().toISOString(), actor);
  return mode;
}

async function getPublicSettings() {
  const s = await getSettings();
  const publicSettings = clone(s);
  if (publicSettings.web) {
    publicSettings.web = {
      ...publicSettings.web,
      token: publicSettings.web.token ? '[hidden]' : '',
    };
  }
  return publicSettings;
}

async function reload() {
  overridesCache = null;
  return getSettings();
}

module.exports = {
  SETTINGS_FILE,
  AUDIT_FILE,
  getSettings,
  getPublicSettings,
  get,
  has,
  set,
  setAlias,
  reset,
  getChatMode,
  setChatMode,
  reload,
  generateToken,
  normalizeReviewTime,
  validateTimezone,
  validateCron,
};
