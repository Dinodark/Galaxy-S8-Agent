const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  extractPrintedToolCall,
  parseToolInvocation,
  stripPrintedToolInvocations,
} = require('../core/tool_call_recovery');

test('parse call/list_notes', () => {
  const inv = parseToolInvocation(JSON.parse('{"call":"list_notes","arguments":{}}'));
  assert.deepEqual(inv, { name: 'list_notes', args: {} });
});

test('extract from fenced json', () => {
  const text =
    'Смотрю базу.\n```json\n{"call":"list_notes","arguments":{}}\n```';
  assert.deepEqual(extractPrintedToolCall(text), { name: 'list_notes', args: {} });
});

test('strip removes fenced pseudo-call', () => {
  const text =
    'Ок.\n```json\n{"call":"list_notes","arguments":{}}\n```\nГотово.';
  assert.equal(stripPrintedToolInvocations(text).includes('list_notes'), false);
});

test('write_note payload not treated as printed tool name', () => {
  const obj = { name: 'inbox.md', content: 'hi' };
  assert.equal(parseToolInvocation(obj), null);
});
