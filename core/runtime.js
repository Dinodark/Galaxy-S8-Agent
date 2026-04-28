const { CronExpressionParser } = require('cron-parser');
const config = require('../config');
const settings = require('./settings');
const journal = require('./journal');
const reminders = require('./reminders');
const modes = require('./modes');
const { startDailyReviewer } = require('./watchers/daily_review');
const { readBatterySnapshot } = require('./watchers/battery');
const { getOpenRouterKeySummary } = require('./llm');

function systemTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function formatDateTime(date, tz) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: tz || systemTz(),
  }).format(date);
}

async function nextDailyReviewFire(fromDate = new Date()) {
  const s = await settings.getSettings();
  if (!s.dailyReview.enabled) return null;
  const tz = s.dailyReview.tz || systemTz();
  const next = CronExpressionParser.parse(s.dailyReview.cron, {
    currentDate: fromDate,
    tz,
  })
    .next()
    .toDate();
  return {
    iso: next.toISOString(),
    local: formatDateTime(next, tz),
    tz,
  };
}

async function buildStatus(chatId) {
  const s = await settings.getSettings();
  const mode = await modes.getMode(chatId);
  const tz = s.dailyReview.tz || systemTz();
  const today = journal.todayStr(tz);
  const entries = await journal.readDay(chatId, today);
  const pendingReminders = await reminders.listPending({ chatId });
  const nextReview = await nextDailyReviewFire();
  const batterySample = await readBatterySnapshot();
  let openrouter = { ok: false };
  try {
    openrouter = await getOpenRouterKeySummary();
  } catch (e) {
    openrouter = { ok: false, error: e && e.message ? e.message : String(e) };
  }

  return {
    mode,
    model: config.openrouter.model,
    allowShell: config.safety.allowShell,
    stt: {
      enabled: s.stt.enabled && !!config.groq.apiKey,
      configured: s.stt.enabled,
      hasGroqKey: !!config.groq.apiKey,
      language: s.stt.language || 'auto',
      model: config.groq.sttModel,
      maxDurationSec: s.stt.maxDurationSec,
    },
    dailyReview: {
      enabled: s.dailyReview.enabled,
      cron: s.dailyReview.cron,
      tz,
      minMessages: s.dailyReview.minMessages,
      prevDays: s.dailyReview.prevDays,
      model: s.dailyReview.model || config.openrouter.model,
      next: nextReview,
      inboxTriage: s.dailyReview.inboxTriage !== false,
      inboxTriageMaxSteps: s.dailyReview.inboxTriageMaxSteps ?? 12,
      clearInboxOnlyAfterWrites: s.dailyReview.clearInboxOnlyAfterWrites !== false,
    },
    journal: {
      today,
      entriesToday: entries.length,
    },
    reminders: {
      pending: pendingReminders.length,
    },
    battery: {
      enabled: config.battery.enabled,
      lowThreshold: config.battery.lowThreshold,
      pollIntervalMs: config.battery.pollIntervalMs,
      sample: batterySample,
    },
    openrouter,
  };
}

function formatStatus(status) {
  const sttState = status.stt.enabled
    ? `on (${status.stt.model}, lang=${status.stt.language})`
    : status.stt.hasGroqKey
      ? 'off'
      : 'off (GROQ_API_KEY missing)';
  const next = status.dailyReview.next
    ? `${status.dailyReview.next.local} (${status.dailyReview.next.tz})`
    : 'disabled';

  return [
    'Agent status',
    '',
    `Mode: ${status.mode}`,
    `Model: ${status.model}`,
    `Shell: ${status.allowShell ? 'enabled' : 'disabled'}`,
    `STT: ${sttState}, max ${status.stt.maxDurationSec}s`,
    `Daily review: ${status.dailyReview.enabled ? 'on' : 'off'}`,
    `Review cron: ${status.dailyReview.cron}`,
    `Review next: ${next}`,
    `Review min messages: ${status.dailyReview.minMessages}`,
    `Review model: ${status.dailyReview.model}`,
    `Inbox triage: ${status.dailyReview.inboxTriage ? 'on' : 'off'} (max steps ${status.dailyReview.inboxTriageMaxSteps})`,
    `Clear inbox only after writes: ${status.dailyReview.clearInboxOnlyAfterWrites ? 'yes' : 'no (legacy)'}`,
    `Journal today: ${status.journal.entriesToday} entries (${status.journal.today})`,
    `Pending reminders: ${status.reminders.pending}`,
    ...formatOpenRouterLines(status.openrouter),
    `Battery watch: ${
      status.battery.enabled ? `on (<${status.battery.lowThreshold}%)` : 'off'
    }`,
  ].join('\n');
}

function formatOpenRouterLines(or) {
  if (!or || !or.ok) {
    const err = or && or.error ? or.error : or && or.httpStatus ? `HTTP ${or.httpStatus}` : 'unavailable';
    return [`OpenRouter key: ${err}`];
  }
  const lines = [];
  if (or.limit_remaining != null && or.limit_remaining !== '') {
    lines.push(`OpenRouter limit remaining: ${or.limit_remaining}`);
  }
  if (or.usage_daily != null && or.usage_daily !== '') {
    lines.push(`OpenRouter usage (daily): ${or.usage_daily}`);
  }
  if (lines.length === 0) lines.push('OpenRouter: OK (no balance fields in /auth/key response)');
  return lines;
}

function createDailyReviewController({ chatIds, onReview, log = console }) {
  let stopCurrent = null;

  function start() {
    if (stopCurrent) stopCurrent();
    stopCurrent = startDailyReviewer({ chatIds, onReview, log });
    return stopCurrent;
  }

  function stop() {
    if (stopCurrent) {
      stopCurrent();
      stopCurrent = null;
    }
  }

  function restart() {
    stop();
    return start();
  }

  return { start, stop, restart };
}

module.exports = {
  systemTz,
  nextDailyReviewFire,
  buildStatus,
  formatStatus,
  createDailyReviewController,
};
