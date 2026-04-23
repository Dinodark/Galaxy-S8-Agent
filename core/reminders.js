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
  };

  list.push(rec);
  await persist();
  return rec;
}

async function listPending({ chatId } = {}) {
  const items = await load();
  return items
    .filter((r) => (chatId == null ? true : r.chatId === Number(chatId)))
    .slice()
    .sort((a, b) => new Date(a.fireAt) - new Date(b.fireAt));
}

async function remove(id) {
  const items = await load();
  const idx = items.findIndex((r) => r.id === id);
  if (idx < 0) return false;
  items.splice(idx, 1);
  await persist();
  return true;
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
  const items = await load();
  const due = [];
  const remaining = [];
  let changed = false;

  for (const r of items) {
    const fireMs = new Date(r.fireAt).getTime();
    if (fireMs <= nowMs) {
      due.push(r);
      changed = true;
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

  if (changed) {
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
  listPending,
  remove,
  popDue,
  startScheduler,
  systemTz,
};
