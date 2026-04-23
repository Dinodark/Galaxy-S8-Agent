const fs = require('fs');
const path = require('path');
const config = require('../config');

class STTError extends Error {
  constructor(message, { status, raw } = {}) {
    super(message);
    this.name = 'STTError';
    this.status = status;
    this.raw = raw;
  }
}

function isEnabled() {
  return config.stt.enabled && !!config.groq.apiKey;
}

function whyDisabled() {
  if (!config.stt.enabled) return 'STT_ENABLED is false in .env';
  if (!config.groq.apiKey) return 'GROQ_API_KEY is not set in .env';
  return null;
}

async function transcribeFile(filePath, { language } = {}) {
  if (!isEnabled()) {
    throw new STTError(`STT disabled: ${whyDisabled()}`);
  }

  if (typeof fetch !== 'function' || typeof FormData !== 'function' || typeof Blob !== 'function') {
    throw new STTError(
      'STT requires Node.js >= 18 (native fetch/FormData/Blob). Update Node in Termux: `pkg upgrade nodejs`.'
    );
  }

  const buf = await fs.promises.readFile(filePath);
  const form = new FormData();
  form.append('file', new Blob([buf]), path.basename(filePath));
  form.append('model', config.groq.sttModel);
  form.append('response_format', 'json');
  const lang = language || config.stt.language;
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
