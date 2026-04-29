const assert = require('assert');
const {
  summarizeMemoryToolStep,
  collectWrittenNotesReported,
  countToolsInTranscript,
} = require('../core/tool_transcript_utils');

function testSummarizeWriteOk() {
  const row = {
    tool: 'write_note',
    args: { name: 'projects/a.md', content: 'hi', append: true },
    result: { ok: true, result: { saved: 'projects/a.md' } },
  };
  const s = summarizeMemoryToolStep(row, 0);
  assert.strictEqual(s.tool, 'write_note');
  assert.strictEqual(s.ok, true);
  assert.strictEqual(s.name, 'projects/a.md');
  assert.strictEqual(s.contentChars, 2);
  assert.strictEqual(s.saved, 'projects/a.md');
}

function testCollectReported() {
  const t = [
    {
      tool: 'write_note',
      result: { ok: true, result: { saved: 'x.md' } },
    },
    {
      tool: 'write_note',
      result: { ok: true, result: { saved: 'x.md' } },
    },
  ];
  assert.deepStrictEqual(collectWrittenNotesReported(t), ['x.md']);
}

function testCounts() {
  const t = [
    { tool: 'list_notes' },
    { tool: 'read_note' },
    { tool: 'write_note' },
  ];
  assert.deepStrictEqual(countToolsInTranscript(t), {
    list_notes: 1,
    read_note: 1,
    write_note: 1,
  });
}

testSummarizeWriteOk();
testCollectReported();
testCounts();
