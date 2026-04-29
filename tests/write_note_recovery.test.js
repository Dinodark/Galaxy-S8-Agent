'use strict';

const assert = require('assert');
const {
  extractWriteNotePayload,
  stripWriteNoteJsonFences,
  extractBalancedJsonObject,
} = require('../core/write_note_recovery');

const sample =
  'Текст до.\n\n```json\n' +
  '{"name":"projects/foo.md","content":"## Title\\n\\nBody with `code` inside."}\n' +
  '```\n\nПосле.';

const parsed = extractWriteNotePayload(sample);
assert.strictEqual(parsed.name, 'projects/foo.md');
assert.ok(parsed.content.includes('Title'));

const fenceInner =
  'intro\n```json\n' +
  '{"name":"a.md","content":"Line1\\n```inner```\\nLine2"}\n' +
  '```';
const p2 = extractWriteNotePayload(fenceInner);
assert.strictEqual(p2.name, 'a.md');

const balanced = extractBalancedJsonObject('xx {"a":1} yy', 3);
assert.strictEqual(balanced, '{"a":1}');

const stripped = stripWriteNoteJsonFences(
  'Привет\n```json\n{"name":"x.md","content":"z"}\n```\nОк.'
);
assert.ok(!stripped.includes('```json'));
assert.ok(!stripped.includes('"name"'));

console.log('write_note_recovery OK');
