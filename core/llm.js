const axios = require('axios');
const config = require('../config');
const llmDebugStore = require('./llm_debug_store');

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
  response_format,
  temperature,
  /** @type {{ scope: string, chatId?: number|null, turnId?: string|null, triageBatchId?: string|null, today?: string|null }|null|undefined} */
  debugContext,
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
  if (response_format) body.response_format = response_format;
  if (temperature !== undefined && temperature !== null) body.temperature = temperature;

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
    const id = await llmDebugStore.maybeRecordError({
      debugContext,
      messages,
      requestBody: body,
      err,
      effectiveModel,
    });
    const wrap = new OpenRouterError(
      `Network error talking to OpenRouter: ${err.message}`,
      { code: err.code }
    );
    if (id) wrap.llmDebugId = id;
    throw wrap;
  }

  if (res.status >= 400) {
    const providerMsg = extractErrorMessage(res.data) || res.statusText;
    console.error(
      `[llm] OpenRouter HTTP ${res.status} for model=${effectiveModel}:`,
      JSON.stringify(res.data, null, 2)
    );
    const id = await llmDebugStore.maybeRecordError({
      debugContext,
      messages,
      requestBody: body,
      err: new Error(`HTTP ${res.status}: ${providerMsg}`),
      effectiveModel,
    });
    const e = new OpenRouterError(
      `OpenRouter ${res.status} (${effectiveModel}): ${providerMsg}`,
      { status: res.status, raw: res.data }
    );
    if (id) e.llmDebugId = id;
    throw e;
  }

  const choice = res.data && res.data.choices && res.data.choices[0];
  if (!choice) {
    const id = await llmDebugStore.maybeRecordError({
      debugContext,
      messages,
      requestBody: body,
      err: new Error(extractErrorMessage(res.data) || 'empty response'),
      effectiveModel,
    });
    const e = new OpenRouterError(
      'OpenRouter returned no choices: ' +
        (extractErrorMessage(res.data) || 'empty response'),
      { raw: res.data }
    );
    if (id) e.llmDebugId = id;
    throw e;
  }

  const id = await llmDebugStore.maybeRecordSuccess({
    debugContext,
    messages,
    requestBody: body,
    responseData: res.data,
  });
  const out = {
    message: choice.message,
    usage: res.data && res.data.usage ? res.data.usage : null,
    model: res.data && res.data.model,
  };
  if (id) out.llmDebugId = id;
  return out;
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

async function checkKey() {
  const res = await axios.get(`${config.openrouter.baseUrl}/key`, {
    headers: { Authorization: `Bearer ${config.openrouter.apiKey}` },
    timeout: 15_000,
    validateStatus: () => true,
  });
  return { status: res.status, data: res.data };
}

/** GET /api/v1/credits — баланс аккаунта (куплено минус использовано). Часто нужен management key. */
async function fetchCredits() {
  const res = await axios.get(`${config.openrouter.baseUrl}/credits`, {
    headers: { Authorization: `Bearer ${config.openrouter.apiKey}` },
    timeout: 15_000,
    validateStatus: () => true,
  });
  return { status: res.status, data: res.data };
}

/**
 * Сводка: GET /api/v1/key (лимиты конкретного API-ключа) + GET /api/v1/credits (остаток на аккаунте).
 * limit_remaining — остаток в рамках лимита ключа (например дневной $2).
 * account_remaining — при доступном /credits: total_credits − total_usage (~общий остаток кошелька).
 */
async function getOpenRouterKeySummary() {
  try {
    const [keyRes, creditsRes] = await Promise.all([checkKey(), fetchCredits()]);

    if (keyRes.status !== 200 || !keyRes.data || typeof keyRes.data !== 'object') {
      return { ok: false, httpStatus: keyRes.status };
    }

    const d = keyRes.data.data != null ? keyRes.data.data : keyRes.data;
    const pick = {};
    // usage_weekly / usage_monthly — расход за окно (средний день: core/openrouter_horizon.js)
    const keys = [
      'label',
      'limit',
      'limit_remaining',
      'limit_reset',
      'usage',
      'usage_daily',
      'usage_weekly',
      'usage_monthly',
      'rate_limit',
      'is_free_tier',
      'include_byok_in_limit',
      'byok_usage',
      'byok_usage_daily',
      'byok_usage_weekly',
      'byok_usage_monthly',
    ];
    for (const k of keys) {
      if (d[k] !== undefined) pick[k] = d[k];
    }

    let accountCreditsOk = false;
    let accountRemaining = null;
    let accountTotalCredits = null;
    let accountTotalUsage = null;
    let accountCreditsHttpStatus = null;
    let accountCreditsMessage = null;

    if (creditsRes.status === 200 && creditsRes.data && creditsRes.data.data) {
      const c = creditsRes.data.data;
      accountTotalCredits = c.total_credits;
      accountTotalUsage = c.total_usage;
      const total = Number(c.total_credits);
      const used = Number(c.total_usage);
      if (Number.isFinite(total) && Number.isFinite(used)) {
        accountRemaining = Math.max(0, total - used);
      }
      accountCreditsOk = true;
    } else {
      accountCreditsHttpStatus = creditsRes.status;
      accountCreditsMessage =
        creditsRes.status === 403
          ? 'для /credits нужен management API key в OpenRouter'
          : extractErrorMessage(creditsRes.data) || `HTTP ${creditsRes.status}`;
    }

    return {
      ok: true,
      currency: 'USD',
      ...pick,
      account_credits_ok: accountCreditsOk,
      account_remaining: accountCreditsOk ? accountRemaining : null,
      account_total_credits: accountCreditsOk ? accountTotalCredits : null,
      account_total_usage: accountCreditsOk ? accountTotalUsage : null,
      account_credits_http_status: accountCreditsOk ? null : accountCreditsHttpStatus,
      account_credits_message: accountCreditsOk ? null : accountCreditsMessage,
    };
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
}

module.exports = {
  chatCompletion,
  checkKey,
  mergeUsage,
  emptyUsage,
  getOpenRouterKeySummary,
  OpenRouterError,
};
