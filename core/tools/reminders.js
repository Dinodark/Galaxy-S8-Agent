const reminders = require('../reminders');

function humanizeDelta(ms) {
  const abs = Math.abs(ms);
  const sign = ms < 0 ? '-' : '';
  if (abs < 60_000) return `${sign}${Math.round(abs / 1000)}s`;
  if (abs < 3_600_000) return `${sign}${Math.round(abs / 60_000)}m`;
  if (abs < 86_400_000) return `${sign}${Math.round(abs / 3_600_000)}h`;
  return `${sign}${Math.round(abs / 86_400_000)}d`;
}

function summarize(rec) {
  const out = {
    id: rec.id,
    text: rec.text,
    fire_at: rec.fireAt,
    fires_in: humanizeDelta(new Date(rec.fireAt).getTime() - Date.now()),
    enabled: rec.enabled !== false,
  };
  if (rec.pausedUntil) out.paused_until = rec.pausedUntil;
  if (rec.recurrence) {
    out.cron = rec.recurrence.cron;
    out.tz = rec.recurrence.tz;
    out.fired_count = rec.firedCount || 0;
    if (rec.maxCount) out.max_count = rec.maxCount;
    if (rec.until) out.until = rec.until;
  }
  return out;
}

module.exports = {
  reminder_add: {
    name: 'reminder_add',
    description:
      'Schedule a reminder. The bot will DM the user at fire time with the text.\n' +
      'One-shot: provide `fire_at` (ISO 8601 with timezone offset, e.g. 2026-04-23T18:00:00+03:00). ' +
      'Compute it yourself using `current_time_local` + `timezone` from the runtime context.\n' +
      'Recurring: provide `cron` — a standard 5-field POSIX cron expression ' +
      '(`minute hour day-of-month month day-of-week`, day-of-week: 0=Sun..6=Sat). ' +
      'Common patterns: "30 7 * * *" = every day 07:30; "0 9 * * 1" = Mondays 9:00; ' +
      '"*/15 * * * *" = every 15 minutes; "0 */3 * * *" = every 3 hours; "0 8 1 * *" = 1st of month 08:00. ' +
      'For recurring, omit `fire_at` (first fire computed from cron) unless you need a custom first occurrence. ' +
      'Optional `tz` (IANA, e.g. "Europe/Moscow"); defaults to the runtime timezone. ' +
      'Optional `until` (ISO 8601) and `max_count` (integer) to bound the recurrence.',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Short text of what to remind about.' },
        fire_at: {
          type: 'string',
          description:
            'ISO 8601 timestamp for one-shot reminders, or a custom first fire for recurring ones.',
        },
        cron: {
          type: 'string',
          description:
            '5-field POSIX cron expression for recurring reminders ("m h dom mon dow").',
        },
        tz: {
          type: 'string',
          description:
            'IANA timezone (e.g. "Europe/Moscow") used to interpret the cron expression.',
        },
        until: {
          type: 'string',
          description: 'ISO 8601 timestamp. Stop recurring after this moment.',
        },
        max_count: {
          type: 'integer',
          minimum: 1,
          description: 'Maximum total fires for a recurring reminder.',
        },
      },
      required: ['text'],
      additionalProperties: false,
    },
    handler: async (
      { text, fire_at, cron, tz, until, max_count },
      ctx = {}
    ) => {
      const chatId = ctx.chatId;
      if (!chatId) {
        throw new Error('reminder_add: missing chatId in context.');
      }
      const rec = await reminders.add({
        chatId,
        text,
        fireAt: fire_at || null,
        cron: cron || null,
        tz: tz || null,
        until: until || null,
        maxCount: max_count == null ? null : max_count,
      });
      return summarize(rec);
    },
  },

  reminder_list: {
    name: 'reminder_list',
    description:
      "List the user's pending reminders (not yet fired), sorted by next fire time. " +
      'Recurring reminders include `cron`, `tz`, and `fired_count`.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: async (_args, ctx = {}) => {
      const chatId = ctx.chatId;
      const items = await reminders.listPending({ chatId });
      return {
        count: items.length,
        reminders: items.map(summarize),
      };
    },
  },

  reminder_delete: {
    name: 'reminder_delete',
    description:
      'Cancel a reminder by id (as returned from reminder_add or reminder_list). ' +
      'This stops any future occurrences of a recurring reminder as well.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async ({ id }) => {
      const ok = await reminders.remove(id);
      return { deleted: ok };
    },
  },

  reminder_update: {
    name: 'reminder_update',
    description:
      'Change an existing reminder (one-shot or recurring). Use ids from reminder_list / reminder_add. ' +
      'For recurring rules you can update `cron`, `tz`, `text`, `fire_at` (next fire ISO), `until`, `max_count`. ' +
      'Set `enabled` to false to turn off without deleting; set back to true to resume. ' +
      'Temporary pause: set `paused_until` to an ISO instant (fires resume after that time; recurring schedules roll forward); ' +
      'use null for `paused_until` to cancel a pause immediately. Shortcut: `clear_pause: true`.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Reminder id.' },
        text: { type: 'string', description: 'Replacement reminder text.' },
        fire_at: {
          type: 'string',
          description:
            'Next fire time (ISO 8601). For recurring, usually omit — next slot is recomputed after cron edits.',
        },
        cron: { type: 'string', description: 'New 5-field cron for recurring reminders only.' },
        tz: {
          type: 'string',
          description: 'IANA timezone for the cron interpretation when changing cron or TZ.',
        },
        until: { type: ['string', 'null'], description: 'Stop recurring after this ISO instant, or null to clear.' },
        max_count: {
          type: ['integer', 'null'],
          minimum: 1,
          description: 'Cap total recurring fires or null.',
        },
        enabled: { type: 'boolean', description: 'false = fully disabled until turned back on.' },
        paused_until: {
          type: ['string', 'null'],
          description: 'Do not fire before this ISO instant; null clears.',
        },
        clear_pause: {
          type: 'boolean',
          description: 'If true, clears paused_until (same as paused_until: null).',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (
      {
        id,
        text,
        fire_at,
        cron,
        tz,
        until,
        max_count,
        enabled,
        paused_until,
        clear_pause,
      },
      ctx = {}
    ) => {
      const chatId = ctx.chatId;
      if (!chatId) {
        throw new Error('reminder_update: missing chatId in context.');
      }
      const next = await reminders.update(id, {
        chatId,
        text,
        fireAt: fire_at,
        cron,
        tz,
        until,
        maxCount: max_count,
        enabled,
        pausedUntil: paused_until,
        clearPause: clear_pause === true,
      });
      if (!next) return { ok: false, error: 'not_found' };
      return summarize(next);
    },
  },
};
