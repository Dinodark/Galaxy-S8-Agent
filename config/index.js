const path = require('path');

require('dotenv').config();

/** Absolute base so reads/writes do not depend on process.cwd(). */
const PROJECT_ROOT = path.resolve(__dirname, '..');

function required(name) {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return v.trim();
}

function optional(name, fallback) {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

function parseBool(v, fallback = false) {
  if (v === undefined || v === null || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

function parseIdList(v) {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => Number(s))
    .filter((n) => Number.isFinite(n));
}

const config = {
  openrouter: {
    apiKey: required('OPENROUTER_API_KEY'),
    model: optional('OPENROUTER_MODEL', 'deepseek/deepseek-chat'),
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  groq: {
    apiKey: optional('GROQ_API_KEY', null),
    sttModel: optional('GROQ_STT_MODEL', 'whisper-large-v3-turbo'),
  },
  stt: {
    enabled: parseBool(process.env.STT_ENABLED, true),
    language: optional('STT_LANGUAGE', 'ru'),
    maxDurationSec: Number(optional('STT_MAX_DURATION_SEC', '300')),
  },
  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    allowedUserIds: parseIdList(process.env.ALLOWED_TELEGRAM_USER_IDS),
    /** 0 = off. Otherwise chat-mode text is held up to this many ms after the last part; all parts in one burst are joined. Solo messages are delayed this long. */
    textCoalesceMs: Number(optional('TELEGRAM_TEXT_COALESCE_MS', '350')),
  },
  agent: {
    maxSteps: Number(optional('AGENT_MAX_STEPS', '8')),
    historyWindow: Number(optional('HISTORY_WINDOW', '30')),
  },
  safety: {
    allowShell: parseBool(process.env.ALLOW_SHELL, false),
  },
  battery: {
    enabled: parseBool(process.env.BATTERY_WATCH_ENABLED, true),
    lowThreshold: Number(optional('BATTERY_LOW_THRESHOLD', '20')),
    pollIntervalMs: Number(optional('BATTERY_POLL_INTERVAL_MS', '300000')),
    hysteresis: Number(optional('BATTERY_HYSTERESIS', '5')),
  },
  reminders: {
    pollIntervalMs: Number(optional('REMINDERS_POLL_INTERVAL_MS', '30000')),
  },
  dailyReview: {
    enabled: parseBool(process.env.DAILY_REVIEW_ENABLED, true),
    cron: optional('DAILY_REVIEW_CRON', '30 22 * * *'),
    tz: optional('DAILY_REVIEW_TZ', ''),
    minMessages: Number(optional('DAILY_REVIEW_MIN_MESSAGES', '3')),
    prevDays: Number(optional('DAILY_REVIEW_PREV_DAYS', '3')),
    model: optional('DAILY_REVIEW_MODEL', ''),
    inboxTriage: parseBool(process.env.DAILY_REVIEW_INBOX_TRIAGE, true),
    inboxTriageMaxSteps: Number(optional('DAILY_REVIEW_INBOX_TRIAGE_MAX_STEPS', '12')),
    /** If true, inbox.md is cleared only after ≥1 successful write_note during triage. */
    clearInboxOnlyAfterWrites: parseBool(
      process.env.DAILY_REVIEW_CLEAR_INBOX_ONLY_AFTER_WRITES,
      true
    ),
  },
  paths: {
    memoryDir: path.join(PROJECT_ROOT, 'memory'),
    historyDir: path.join(PROJECT_ROOT, 'memory', 'history'),
    journalDir: path.join(PROJECT_ROOT, 'memory', 'journal'),
    notesDir: path.join(PROJECT_ROOT, 'memory', 'notes'),
    tmpDir: path.join(PROJECT_ROOT, 'memory', 'tmp'),
    logsDir: path.join(PROJECT_ROOT, 'logs'),
  },
  logLevel: optional('LOG_LEVEL', 'info'),
};

if (config.telegram.allowedUserIds.length === 0) {
  console.warn(
    '[config] WARNING: ALLOWED_TELEGRAM_USER_IDS is empty. The bot will refuse all users. ' +
      'Set at least your own Telegram user id in .env.'
  );
}

module.exports = config;
