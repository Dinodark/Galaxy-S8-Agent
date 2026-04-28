const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fse = require('fs-extra');
const config = require('../config');
const inboxTriageLog = require('../core/inbox_triage_log');

const file = path.join(config.paths.memoryDir, 'logs', 'inbox_triage.jsonl');

test('readRecent: empty when file missing', async () => {
  await fse.remove(file).catch(() => {});
  const out = await inboxTriageLog.readRecent(10);
  assert.equal(Array.isArray(out.entries), true);
  assert.equal(out.entries.length, 0);
});

test('append + readRecent roundtrip', async () => {
  await fse.remove(file).catch(() => {});
  await inboxTriageLog.logTriageRun({
    chatId: 1,
    today: '2099-01-01',
    result: { skipped: true, reason: 'test' },
  });
  const out = await inboxTriageLog.readRecent(5);
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].skipped, true);
  assert.equal(out.entries[0].reason, 'test');
  await fse.remove(file).catch(() => {});
});
