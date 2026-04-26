const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const axios = require('axios');
require('dotenv').config();

const ROOT = path.join(__dirname, '..');

const results = [];

function add(level, name, detail) {
  results.push({ level, name, detail });
}

function ok(name, detail = '') {
  add('OK', name, detail);
}

function warn(name, detail = '') {
  add('WARN', name, detail);
}

function fail(name, detail = '') {
  add('FAIL', name, detail);
}

function hasCommand(cmd) {
  const res = spawnSync('sh', ['-lc', `command -v ${cmd}`], {
    encoding: 'utf8',
  });
  return res.status === 0;
}

async function checkOpenRouter() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    fail('OpenRouter key', 'OPENROUTER_API_KEY is missing');
    return;
  }
  try {
    const res = await axios.get('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (res.status === 200) ok('OpenRouter key', 'auth/key returned 200');
    else fail('OpenRouter key', `auth/key returned HTTP ${res.status}`);
  } catch (err) {
    warn('OpenRouter network', err.message);
  }
}

async function checkGroq() {
  const key = process.env.GROQ_API_KEY;
  if (!key) {
    warn('Groq key', 'GROQ_API_KEY is empty; voice-to-text will be disabled');
    return;
  }
  try {
    const res = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      timeout: 15_000,
      validateStatus: () => true,
    });
    if (res.status === 200) ok('Groq key', 'models endpoint returned 200');
    else warn('Groq key', `models endpoint returned HTTP ${res.status}`);
  } catch (err) {
    warn('Groq network', err.message);
  }
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) ok('Node.js', process.version);
  else fail('Node.js', `${process.version}; need >= 18`);
}

function checkEnv() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) ok('.env', 'found');
  else fail('.env', 'missing; run npm run setup');

  for (const key of [
    'TELEGRAM_BOT_TOKEN',
    'ALLOWED_TELEGRAM_USER_IDS',
    'OPENROUTER_API_KEY',
  ]) {
    if (process.env[key]) ok(`env ${key}`, 'set');
    else fail(`env ${key}`, 'missing');
  }
}

function checkSettings() {
  const settingsPath = path.join(ROOT, 'memory', 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    warn('settings', 'memory/settings.json missing; defaults will be used');
    return;
  }
  try {
    const s = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    if (s.web && s.web.token) ok('web token', 'configured');
    else warn('web token', 'missing; it will be generated on next settings load');
    if (s.web && s.web.port) ok('web port', String(s.web.port));
  } catch (err) {
    warn('settings', `cannot parse memory/settings.json: ${err.message}`);
  }
}

function checkTermux() {
  if (process.env.PREFIX && process.env.PREFIX.includes('com.termux')) {
    ok('Termux', process.env.PREFIX);
  } else {
    warn('Termux', 'not detected; phone tools will be unavailable on this machine');
  }

  if (hasCommand('termux-battery-status')) {
    ok('termux-api', 'termux-battery-status found');
  } else {
    warn('termux-api', 'termux-battery-status not found; install Termux:API app + pkg termux-api');
  }

  if (hasCommand('tmux')) ok('tmux', 'found');
  else warn('tmux', 'not found; installer installs it on Termux');
}

async function main() {
  checkNode();
  checkEnv();
  checkSettings();
  checkTermux();
  await checkOpenRouter();
  await checkGroq();

  console.log('Vatoko Galaxy doctor');
  console.log('');
  for (const r of results) {
    console.log(`[${r.level}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  }

  const hasFail = results.some((r) => r.level === 'FAIL');
  process.exit(hasFail ? 1 : 0);
}

main().catch((err) => {
  console.error('doctor failed:', err.message);
  process.exit(1);
});
