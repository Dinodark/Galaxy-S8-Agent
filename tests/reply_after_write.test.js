'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tightenReplyAfterWrite } = require('../core/agent');

const longReply = 'x'.repeat(500);
const transcriptOk = [
  {
    tool: 'write_note',
    result: { ok: true, result: { saved: 'ideas.md' } },
  },
];

test('tightenReplyAfterWrite: compress long reply when write intent', () => {
  const out = tightenReplyAfterWrite({
    transcript: transcriptOk,
    userMessage: 'запиши мысль про игру',
    reply: longReply,
    writeIntent: true,
    hImplicit: false,
  });
  assert.ok(out.includes('memory/notes/ideas.md'));
  assert.ok(out.length < longReply.length);
});

test('tightenReplyAfterWrite: keep when user asks explain', () => {
  const out = tightenReplyAfterWrite({
    transcript: transcriptOk,
    userMessage: 'запиши и подробно объясни почему это важно',
    reply: longReply,
    writeIntent: true,
    hImplicit: false,
  });
  assert.equal(out, longReply);
});

test('tightenReplyAfterWrite: keep short reply', () => {
  const short = 'Ок, записал в ideas.md';
  const out = tightenReplyAfterWrite({
    transcript: transcriptOk,
    userMessage: 'добавь в идеи',
    reply: short,
    writeIntent: true,
    hImplicit: false,
  });
  assert.equal(out, short);
});

test('tightenReplyAfterWrite: no write in transcript', () => {
  const out = tightenReplyAfterWrite({
    transcript: [],
    userMessage: 'привет',
    reply: longReply,
    writeIntent: true,
    hImplicit: false,
  });
  assert.equal(out, longReply);
});

test('tightenReplyAfterWrite: implicit voice capture without explicit write', () => {
  const out = tightenReplyAfterWrite({
    transcript: transcriptOk,
    userMessage: 'x'.repeat(200),
    reply: longReply,
    writeIntent: false,
    hImplicit: true,
  });
  assert.ok(out.includes('ideas.md'));
});
