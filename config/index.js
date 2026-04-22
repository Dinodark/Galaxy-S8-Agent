require('dotenv').config();

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
    model: optional('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  telegram: {
    token: required('TELEGRAM_BOT_TOKEN'),
    allowedUserIds: parseIdList(process.env.ALLOWED_TELEGRAM_USER_IDS),
  },
  agent: {
    maxSteps: Number(optional('AGENT_MAX_STEPS', '8')),
    historyWindow: Number(optional('HISTORY_WINDOW', '30')),
  },
  safety: {
    allowShell: parseBool(process.env.ALLOW_SHELL, false),
  },
  paths: {
    memoryDir: 'memory',
    historyDir: 'memory/history',
    notesDir: 'memory/notes',
    logsDir: 'logs',
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
