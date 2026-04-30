const test = require('node:test');
const assert = require('node:assert/strict');

const { remindersByCalendarMonth } = require('../core/reminders');

test('cron Mon+Fri April 2026 in Europe/Moscow', () => {
  const list = [
    {
      id: 'r1',
      text: 'Ушу',
      fireAt: '2026-04-01T06:00:00.000Z',
      enabled: true,
      pausedUntil: null,
      recurrence: { cron: '0 9 * * 1,5', tz: 'Europe/Moscow' },
    },
  ];
  const byDay = remindersByCalendarMonth(list, 2026, 4, 'Europe/Moscow');
  const keys = Object.keys(byDay).sort();
  assert.ok(keys.length >= 8);
  assert.ok(keys.includes('2026-04-03'));
  assert.ok(keys.includes('2026-04-06'));
});

test('paused recurring does not appear on calendar map', () => {
  const future = new Date(Date.now() + 7 * 86400000).toISOString();
  const list = [
    {
      id: 'r2',
      text: 'x',
      fireAt: '2026-04-07T06:00:00.000Z',
      enabled: true,
      pausedUntil: future,
      recurrence: { cron: '0 9 * * 1', tz: 'Europe/Moscow' },
    },
  ];
  const byDay = remindersByCalendarMonth(list, 2026, 4, 'Europe/Moscow');
  assert.equal(Object.keys(byDay).length, 0);
});

test('disabled recurring hidden from calendar', () => {
  const list = [
    {
      id: 'r3',
      text: 'x',
      fireAt: '2026-04-07T06:00:00.000Z',
      enabled: false,
      pausedUntil: null,
      recurrence: { cron: '0 9 * * 1', tz: 'Europe/Moscow' },
    },
  ];
  const byDay = remindersByCalendarMonth(list, 2026, 4, 'Europe/Moscow');
  assert.equal(Object.keys(byDay).length, 0);
});
