const fs = require('fs');
const path = require('path');
const config = require('../config');
const settings = require('./settings');

class STTError extends Error {
  constructor(message, { status, raw } = {}) {
    super(message);
    this.name = 'STTError';
    this.status = status;
    this.raw = raw;
  }
}

async function isEnabled() {
  return !!(await settings.get('stt.enabled')) && !!config.groq.apiKey;
}

async function whyDisabled() {
  if (!(await settings.get('stt.enabled'))) return 'STT is disabled in settings';
  if (!config.groq.apiKey) return 'GROQ_API_KEY is not set in .env';
  return null;
}

// Groq's Whisper endpoint validates file type by filename extension on
// multipart upload. It accepts: flac, mp3, mp4, mpeg, mpga, m4a, ogg,
// opus, wav, webm. Telegram sometimes hands us `.oga` (OGG audio
// variant) for voice notes, which Groq rejects, so we rewrite the
// extension to a supported synonym.
const EXT_ALIASES = {
  oga: 'ogg',
  ogx: 'ogg',
  weba: 'webm',
};
const GROQ_SUPPORTED = new Set([
  'flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm',
]);

function normalizeFilename(filePath) {
  const base = path.basename(filePath);
  const dot = base.lastIndexOf('.');
  if (dot < 0) return `${base}.ogg`;
  const stem = base.slice(0, dot);
  const ext = base.slice(dot + 1).toLowerCase();
  const mapped = EXT_ALIASES[ext] || ext;
  if (!GROQ_SUPPORTED.has(mapped)) return `${stem}.ogg`;
  return `${stem}.${mapped}`;
}

async function transcribeFile(filePath, { language } = {}) {
  if (!(await isEnabled())) {
    throw new STTError(`STT disabled: ${await whyDisabled()}`);
  }

  if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new STTError(
      'STT requires Node.js >= 18 (native fetch/FormData/Blob). Update Node in Termux: `pkg upgrade nodejs`.'
    );
  }

  const buf = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), normalizeFilename(filePath));
  form.append('model', config.groq.sttModel);
  form.append('response_format', 'json');
  const lang = language || (await settings.get('stt.language'));
  if (lang) form.append('language', lang);

  let res;
  try {
    res = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.groq.apiKey}` },
      body: form,
    });
  } catch (err) {
    throw new STTError(`Network error talking to Groq: ${err.message}`);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON response
  }

  if (!res.ok) {
    const msg =
      (data && data.error && (data.error.message || data.error)) ||
      res.statusText ||
      'unknown error';
    throw new STTError(`Groq STT ${res.status}: ${msg}`, {
      status: res.status,
      raw: data,
    });
  }

  return (data && data.text) || '';
}

module.exports = { transcribeFile, isEnabled, whyDisabled, STTError };
