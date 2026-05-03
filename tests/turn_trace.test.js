'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  summarizeToolTranscript,
  safeRouteSnapshot,
  userMessageSha256,
} = require('../core/turn_trace');

test('summarizeToolTranscript: write_note saved + ok', () => {
  const rows = summarizeToolTranscript([
    {
      tool: 'write_note',
      args: { name: 'ideas.md' },
      result: { ok: true, result: { saved: 'ideas.md' } },
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tool, 'write_note');
  assert.equal(rows[0].ok, true);
  assert.equal(rows[0].saved, 'ideas.md');
});

test('summarizeToolTranscript: flags', () => {
  const rows = summarizeToolTranscript([
    {
      tool: 'list_notes',
      result: { ok: true, result: { files: [] } },
      preloaded: true,
    },
    {
      tool: 'write_note',
      result: { ok: false, error: 'x'.repeat(300) },
      fallback: true,
    },
  ]);
  assert.equal(rows[0].preloaded, true);
  assert.equal(rows[1].ok, false);
  assert.ok(rows[1].err.length <= 240);
  assert.equal(rows[1].fallback, true);
});

test('safeRouteSnapshot: skipped', () => {
  assert.deepEqual(safeRouteSnapshot({ skipped: true }), { skipped: true });
});

test('safeRouteSnapshot: intent + confidence', () => {
  const s = safeRouteSnapshot({ ok: true, intent: 'chat', confidence: 0.9 });
  assert.equal(s.ok, true);
  assert.equal(s.intent, 'chat');
  assert.equal(s.confidence, 0.9);
});

test('userMessageSha256 stable', () => {
  const a = userMessageSha256('hello');
  const b = userMessageSha256('hello');
  assert.equal(a, b);
  assert.notEqual(a, userMessageSha256('hello2'));
});
