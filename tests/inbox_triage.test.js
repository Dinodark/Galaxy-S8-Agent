const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  triageToolSchemas,
  isInboxAlreadyCleared,
  INBOX_SCAFFOLD,
} = require('../core/watchers/inbox_triage');

test('triageToolSchemas: only memory triage tools', () => {
  const names = triageToolSchemas().map((s) => s.function.name).sort();
  assert.deepEqual(names, ['list_notes', 'read_note', 'write_note']);
});

test('isInboxAlreadyCleared: empty or scaffold', () => {
  assert.equal(isInboxAlreadyCleared(''), true);
  assert.equal(isInboxAlreadyCleared('   \n'), true);
  assert.equal(isInboxAlreadyCleared(INBOX_SCAFFOLD), true);
  assert.equal(isInboxAlreadyCleared('# Inbox\n\nСохрани это важное.'), false);
});
