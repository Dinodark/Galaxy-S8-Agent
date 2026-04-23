const axios = require('axios');
const config = require('../config');

class OpenRouterError extends Error {
  constructor(message, { status, code, raw } = {}) {
    super(message);
    this.name = 'OpenRouterError';
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

function extractErrorMessage(data) {
  if (!data) return null;
  if (typeof data === 'string') return data;
  if (data.error) {
    if (typeof data.error === 'string') return data.error;
    if (data.error.message) return data.error.message;
  }
  if (data.message) return data.message;
  try {
    return JSON.stringify(data);
  } catch {
    return null;
  }
}

async function chatCompletion({
  messages,
  tools,
  toolChoice = 'auto',
  model,
  timeoutMs,
}) {
  const effectiveModel = model || config.openrouter.model;
  const body = {
    model: effectiveModel,
    messages,
  };
  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = toolChoice;
  }

  let res;
  try {
    res = await axios.post(
      `${config.openrouter.baseUrl}/chat/completions`,
      body,
      {
        headers: {
          Authorization: `Bearer ${config.openrouter.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/Dinodark/Galaxy-S8-Agent',
          'X-Title': 'Galaxy S8 Agent',
        },
        timeout: timeoutMs || 60_000,
        validateStatus: () => true,
      }
    );
  } catch (err) {
    throw new OpenRouterError(
      `Network error talking to OpenRouter: ${err.message}`,
      { code: err.code }
    );
  }

  if (res.status >= 400) {
    const providerMsg = extractErrorMessage(res.data) || res.statusText;
    console.error(
      `[llm] OpenRouter HTTP ${res.status} for model=${effectiveModel}:`,
      JSON.stringify(res.data, null, 2)
    );
    throw new OpenRouterError(
      `OpenRouter ${res.status} (${effectiveModel}): ${providerMsg}`,
      { status: res.status, raw: res.data }
    );
  }

  const choice = res.data && res.data.choices && res.data.choices[0];
  if (!choice) {
    throw new OpenRouterError(
      'OpenRouter returned no choices: ' +
        (extractErrorMessage(res.data) || 'empty response'),
      { raw: res.data }
    );
  }
  return choice.message;
}

async function checkKey() {
  const res = await axios.get(`${config.openrouter.baseUrl}/auth/key`, {
    headers: { Authorization: `Bearer ${config.openrouter.apiKey}` },
    timeout: 15_000,
    validateStatus: () => true,
  });
  return { status: res.status, data: res.data };
}

module.exports = { chatCompletion, checkKey, OpenRouterError };
