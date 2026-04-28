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
          'X-Title': 'Vatoko Galaxy',
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
  return {
    message: choice.message,
    usage: res.data && res.data.usage ? res.data.usage : null,
    model: res.data && res.data.model,
  };
}

/** Sum token counts across multi-step agent / ingest loops. */
function mergeUsage(acc, usage) {
  if (!usage || typeof usage !== 'object') return acc;
  acc.prompt_tokens += Number(usage.prompt_tokens) || 0;
  acc.completion_tokens += Number(usage.completion_tokens) || 0;
  acc.total_tokens += Number(usage.total_tokens) || 0;
  const topCost =
    typeof usage.total_cost === 'number'
      ? usage.total_cost
      : typeof usage.cost === 'number'
        ? usage.cost
        : typeof usage.native_tokens_cost === 'number'
          ? usage.native_tokens_cost
          : null;
  if (typeof topCost === 'number') acc.cost += topCost;
  return acc;
}

function emptyUsage() {
  return { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, cost: 0 };
}

/**
 * Credits / usage for the configured API key (GET /auth/key).
 * Shape varies; we only expose non-sensitive bookkeeping fields for the dashboard.
 */
async function getOpenRouterKeySummary() {
  try {
    const { status, data } = await checkKey();
    if (status !== 200 || !data || typeof data !== 'object') {
      return { ok: false, httpStatus: status };
    }
    const d = data.data != null ? data.data : data;
    const pick = {};
    const keys = [
      'limit',
      'limit_remaining',
      'usage',
      'usage_daily',
      'usage_weekly',
      'usage_monthly',
      'rate_limit',
    ];
    for (const k of keys) {
      if (d[k] !== undefined) pick[k] = d[k];
    }
    return { ok: true, ...pick };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

async function checkKey() {
  const res = await axios.get(`${config.openrouter.baseUrl}/auth/key`, {
    headers: { Authorization: `Bearer ${config.openrouter.apiKey}` },
    timeout: 15_000,
    validateStatus: () => true,
  });
  return { status: res.status, data: res.data };
}

module.exports = {
  chatCompletion,
  checkKey,
  mergeUsage,
  emptyUsage,
  getOpenRouterKeySummary,
  OpenRouterError,
};
