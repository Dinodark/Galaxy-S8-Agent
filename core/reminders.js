const path = require('path');
const fse = require('fs-extra');
const { CronExpressionParser } = require('cron-parser');
const config = require('../config');

const STORE_FILE = path.join(config.paths.memoryDir, 'reminders.json');

function systemTz() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

let cache = null;
let saveChain = Promise.resolve();

async function load() {
  if (cache) return cache;
  if (await fse.pathExists(STORE_FILE)) {
    try {
      cache = await fse.readJson(STORE_FILE);
      if (!Array.isArray(cache)) cache = [];
    } catch {
      cache = [];
    }
  } else {
    cache = [];
  }
  return cache;
}

function persist() {
  saveChain = saveChain.then(async () => {
    await fse.ensureDir(path.dirname(STORE_FILE));
    await fse.writeJson(STORE_FILE, cache, { spaces: 2 });
  });
  return saveChain;
}

function newId() {
  const rand = Math.random().toString(36).slice(2, 8);
  return `rem_${Date.now().toString(36)}_${rand}`;
}

function parseIsoStrict(value, field) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(
      `Invalid ${field}: "${value}". Expected ISO 8601 (e.g. 2026-04-23T18:00:00+03:00).`
    );
  }
  return d;
}

function validateCron(expr, tz) {
  try {
    CronExpressionParser.parse(expr, { currentDate: new Date(), tz });
  } catch (err) {
    throw new Error(
      `Invalid cron "${expr}": ${err.message}. Expected 5 fields: "minute hour day-of-month month day-of-week".`
    );
  }
}

function nextCronOccurrence(cron, tz, afterDate) {
  const interval = CronExpressionParser.parse(cron, {
    currentDate: afterDate,
    tz,
  });
  return interval.next().toDate();
}

async function add({
  chatId,
  text,
  fireAt = null,
  cron = null,
  tz = null,
  until = null,
  maxCount = null,
}) {
  const list = await load();

  let recurrence = null;
  let firstFireAt;

  if (cron) {
    const cronTz = tz || systemTz();
    validateCron(cron, cronTz);
    recurrence = { cron, tz: cronTz };
    firstFireAt = fireAt
      ? parseIsoStrict(fireAt, 'fire_at')
      : nextCronOccurrence(cron, cronTz, new Date());
  } else if (fireAt) {
    firstFireAt = parseIsoStrict(fireAt, 'fire_at');
  } else {
    throw new Error('reminder_add: either fire_at or cron must be provided.');
  }

  let untilIso = null;
  if (until != null && until !== '') {
    untilIso = parseIsoStrict(until, 'until').toISOString();
    if (new Date(untilIso).getTime() < firstFireAt.getTime()) {
      throw new Error('reminder_add: until must be after the first fire time.');
    }
  }

  let maxCountNum = null;
  if (maxCount != null) {
    const n = Number(maxCount);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error('reminder_add: max_count must be a positive integer.');
    }
    maxCountNum = n;
  }

  const rec = {
    id: newId(),
    chatId: Number(chatId),
    text: String(text),
    fireAt: firstFireAt.toISOString(),
    createdAt: new Date().toISOString(),
    recurrence,
    until: untilIso,
    maxCount: maxCountNum,
    firedCount: 0,
    enabled: true,
    pausedUntil: null,
  };

  list.push(rec);
  await persist();
  return rec;
}

async function listPending({ chatId } = {}) {
  const items = await load();
  const pending = items
    .filter((r) => (chatId == null ? true : r.chatId === Number(chatId)))
    .slice()
    .sort((a, b) => new Date(a.fireAt) - new Date(b.fireAt));
  return pending;
}

async function remove(id) {
  const items = await load();
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  items.splice(idx, 1);
  await persist();
  return true;
}

/** YYYY-MM-DD for an instant interpreted in tz (IANA). */
function dayKeyInTz(when /* Date | ISO string */, tz) {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-CA', { timeZone: tz });
}

/** True if this reminder may fire notifications at nowMs (paused / disabled skips). */
function isDeliveryEligible(rec, nowMs = Date.now()) {
  if (rec.enabled === false) return false;
  if (rec.pausedUntil == null || rec.pausedUntil === '') return true;
  const pu = new Date(rec.pausedUntil).getTime();
  if (Number.isNaN(pu)) return true;
  return nowMs >= pu;
}

/** Clear expired pausedUntil and reschedule recurring reminders if fires were skipped. */
function normalizeAfterPauseExpiry(rec, nowMs, log) {
  if (!rec.pausedUntil) return rec;
  const pu = new Date(rec.pausedUntil).getTime();
  if (Number.isNaN(pu) || nowMs < pu) return rec;

  let nextRec = { ...rec, pausedUntil: null };
  if (!nextRec.recurrence?.cron || !nextRec.recurrence?.tz) {
    return nextRec;
  }
  const fireMs = new Date(nextRec.fireAt).getTime();
  if (!Number.isNaN(fireMs) && fireMs <= nowMs) {
    try {
      const nextFire = nextCronOccurrence(
        nextRec.recurrence.cron,
        nextRec.recurrence.tz,
        new Date(nowMs)
      );
      nextRec = {
        ...nextRec,
        fireAt: nextFire.toISOString(),
      };
    } catch (err) {
      log.warn(`[reminders] reschedule after pause for ${nextRec.id}:`, err.message);
    }
  }
  return nextRec;
}

/**
 * Cron firing calendar days inside a Gregorian month, in `tz` (YYYY-MM-DD).
 */
function cronDayKeysInCalendarMonth(cron, tz, year, calendarMonth1to12) {
  const padded = String(calendarMonth1to12).padStart(2, '0');
  const startISO = `${year}-${padded}-01T00:00:00`;
  const ny = calendarMonth1to12 === 12 ? year + 1 : year;
  const nm =
    calendarMonth1to12 === 12 ? '01' : String(calendarMonth1to12 + 1).padStart(2, '0');
  const endISO = `${ny}-${nm}-01T00:00:00`;
  const keys = [];
  const seen = new Set();
  try {
    const interval = CronExpressionParser.parse(cron, {
      currentDate: startISO,
      endDate: endISO,
      tz,
    });
    while (keys.length < 124) {
      let nextDate;
      try {
        nextDate = interval.next().toDate();
      } catch {
        break;
      }
      const k = dayKeyInTz(nextDate, tz);
      if (k && !seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  } catch {
    /* invalid cron expression */
  }
  return keys;
}

/**
 * @param {{ id: string; text?: string; fireAt?: string; recurrence?: unknown; enabled?: boolean; pausedUntil?: string | null }} rec
 */
function occurrencesForReminderInMonth(rec, year, calendarMonth /** 1–12 */, defaultTz, nowMs = Date.now()) {
  const tzHint = defaultTz || systemTz();

  const enabled = rec.enabled !== false;
  let pausedEffective = false;
  if (rec.pausedUntil) {
    const pu = new Date(rec.pausedUntil).getTime();
    if (!Number.isNaN(pu) && nowMs < pu) pausedEffective = true;
  }

  if (!enabled || pausedEffective) {
    return [];
  }

  if (rec.recurrence?.cron && rec.recurrence?.tz) {
    return cronDayKeysInCalendarMonth(
      rec.recurrence.cron,
      rec.recurrence.tz,
      year,
      calendarMonth
    );
  }

  const k = dayKeyInTz(rec.fireAt, tzHint);
  if (!k) return [];
  const monthPrefix = `${year}-${String(calendarMonth).padStart(2, '0')}`;
  return k.startsWith(monthPrefix) ? [k] : [];
}

/**
 * Merge per-day summaries for dashboard calendar (`tz` fallback for non-recurring).
 */
function remindersByCalendarMonth(remindersList, year, calendarMonth, defaultTz, nowMs = Date.now()) {
  const out = {};
  for (const r of remindersList) {
    const days = occurrencesForReminderInMonth(r, year, calendarMonth, defaultTz, nowMs);
    for (const key of days) {
      if (!out[key]) out[key] = [];
      out[key].push({ id: r.id, text: r.text });
    }
  }
  return out;
}

/** Advance recurring `fireAt` past now when the rule is active and eligibility allows delivery. */
function snapRecurringFireIfStale(rec) {
  if (rec.enabled === false || !rec.recurrence?.cron || !rec.recurrence.tz) return rec;
  if (!isDeliveryEligible(rec, Date.now())) return rec;
  const nowMs = Date.now();
  const fireMs = new Date(rec.fireAt).getTime();
  if (Number.isNaN(fireMs) || fireMs > nowMs) return rec;
  try {
    return {
      ...rec,
      fireAt: nextCronOccurrence(rec.recurrence.cron, rec.recurrence.tz, new Date(nowMs)).toISOString(),
    };
  } catch {
    return rec;
  }
}

async function update(
  id,
  {
    chatId,
    text = undefined,
    fireAt = undefined,
    cron = undefined,
    tz = undefined,
    until = undefined,
    maxCount = undefined,
    enabled = undefined,
    pausedUntil = undefined,
    clearPause = undefined,
  } = {}
) {
  const items = await load();
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return null;
  const cur = items[idx];
  if (chatId != null && cur.chatId !== Number(chatId)) return null;

  let patch = {};

  if (text !== undefined) patch.text = String(text);

  if (pausedUntil !== undefined) {
    if (pausedUntil === null || pausedUntil === '') {
      patch.pausedUntil = null;
    } else {
      patch.pausedUntil = parseIsoStrict(pausedUntil, 'paused_until').toISOString();
    }
  }

  if (clearPause === true) {
    patch.pausedUntil = null;
  }

  if (enabled !== undefined) {
    patch.enabled = Boolean(enabled);
  }

  let nextRecurrence = cur.recurrence;
  if (cron !== undefined) {
    const cronTz = tz != null ? String(tz) : cur.recurrence?.tz || systemTz();
    validateCron(String(cron), cronTz);
    nextRecurrence = { cron: String(cron), tz: cronTz };
    patch.recurrence = nextRecurrence;
  } else if (tz !== undefined && cur.recurrence?.cron) {
    validateCron(cur.recurrence.cron, String(tz));
    nextRecurrence = { ...cur.recurrence, tz: String(tz) };
    patch.recurrence = nextRecurrence;
  }

  if (until !== undefined) {
    if (until === null || until === '') {
      patch.until = null;
    } else {
      patch.until = parseIsoStrict(until, 'until').toISOString();
    }
  }

  if (maxCount !== undefined) {
    if (maxCount === null || maxCount === '') {
      patch.maxCount = null;
    } else {
      const n = Number(maxCount);
      if (!Number.isInteger(n) || n < 1) {
        throw new Error('reminder_update: max_count must be a positive integer or null.');
      }
      patch.maxCount = n;
    }
  }

  let nextFireAt = fireAt !== undefined ? parseIsoStrict(fireAt, 'fire_at') : undefined;

  if (nextRecurrence?.cron && nextFireAt === undefined && cron !== undefined) {
    nextFireAt = nextCronOccurrence(nextRecurrence.cron, nextRecurrence.tz, new Date());
  }

  if (nextFireAt !== undefined) {
    patch.fireAt = nextFireAt.toISOString();
  }

  let updated = {
    ...cur,
    ...patch,
  };

  updated = snapRecurringFireIfStale(updated);

  if (updated.until != null && updated.until !== '') {
    if (new Date(updated.until).getTime() < new Date(updated.fireAt).getTime()) {
      throw new Error('reminder_update: until must be after the scheduled fire time.');
    }
  }

  items[idx] = updated;
  await persist();
  return updated;
}

function computeNextFire(rec, nowMs, log = console) {
  if (!rec.recurrence || !rec.recurrence.cron) return null;

  const nextFiredCount = (rec.firedCount || 0) + 1;
  if (rec.maxCount != null && nextFiredCount >= rec.maxCount) return null;

  try {
    // Advance from the later of (now, prev fireAt + 1ms) so we never re-fire
    // the same slot, even if the tick was late.
    const after = new Date(
      Math.max(nowMs, new Date(rec.fireAt).getTime() + 1)
    );
    const next = nextCronOccurrence(rec.recurrence.cron, rec.recurrence.tz, after);
    if (rec.until) {
      const untilMs = new Date(rec.until).getTime();
      if (next.getTime() > untilMs) return null;
    }
    return next;
  } catch (err) {
    log.warn(`[reminders] bad cron for ${rec.id}:`, err.message);
    return null;
  }
}

async function popDue(nowMs = Date.now(), log = console) {
  await load();

  let items = [...cache];
  let normalizedDirty = false;
  items = items.map((r) => {
    const n = normalizeAfterPauseExpiry(r, nowMs, log);
    if (n.pausedUntil !== r.pausedUntil || n.fireAt !== r.fireAt) normalizedDirty = true;
    return n;
  });

  const due = [];
  const remaining = [];
  let dueDirty = false;

  if (normalizedDirty) {
    cache = items;
    await persist();
  }

  items = [...cache];

  for (const r of items) {
    if (!isDeliveryEligible(r, nowMs)) {
      remaining.push(r);
      continue;
    }
    const fireMs = new Date(r.fireAt).getTime();
    if (fireMs <= nowMs) {
      due.push(r);
      dueDirty = true;
      const next = computeNextFire(r, nowMs, log);
      if (next) {
        remaining.push({
          ...r,
          fireAt: next.toISOString(),
          firedCount: (r.firedCount || 0) + 1,
        });
      }
    } else {
      remaining.push(r);
    }
  }

  if (dueDirty) {
    cache = remaining;
    await persist();
  }
  return due;
}

function startScheduler({ onFire, log = console }) {
  const interval = config.reminders.pollIntervalMs;
  let stopped = false;
  let timer = null;

  async function tick() {
    if (stopped) return;
    let due = [];
    try {
      due = await popDue(Date.now(), log);
    } catch (err) {
      log.warn('[reminders] read error:', err.message);
      return;
    }
    for (const r of due) {
      try {
        await onFire(r);
      } catch (err) {
        log.warn(`[reminders] fire failed for ${r.id}:`, err.message);
      }
    }
  }

  setTimeout(tick, 1500);
  timer = setInterval(tick, interval);
  log.log(
    `[reminders] scheduler started (poll every ${Math.round(interval / 1000)}s, tz=${systemTz()})`
  );

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
  };
}

module.exports = {
  add,
  update,
  listPending,
  remove,
  popDue,
  startScheduler,
  systemTz,
  remindersByCalendarMonth,
  dayKeyInTz,
};
