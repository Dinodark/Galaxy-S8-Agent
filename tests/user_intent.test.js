const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  userAskedToWriteMemory,
  userAskedForMemoryInventory,
  shouldUseDeterministicMemoryInventory,
} = require('../core/user_intent');

test('userAskedToWriteMemory: common Russian phrasing', () => {
  assert.equal(userAskedToWriteMemory('Сохрани это в заметки'), true);
  assert.equal(userAskedToWriteMemory('нужно внести в базу: раздел 2'), true);
  assert.equal(userAskedToWriteMemory('Добавь в базу важный факт.'), true);
  assert.equal(userAskedToWriteMemory('нужно сохранить контакты'), true);
  assert.equal(userAskedToWriteMemory('Сохранить бы это куда-нибудь'), true);
});

test('userAskedToWriteMemory: false for bare continuation (merge must supply first block)', () => {
  assert.equal(
    userAskedToWriteMemory('Просто продолжение без глагола.'),
    false
  );
});

test('userAskedForMemoryInventory: list-only without write', () => {
  const q = 'Какие файлы есть в базе знаний?';
  assert.equal(userAskedForMemoryInventory(q), true);
  assert.equal(userAskedToWriteMemory(q), false);
});

test('userAskedForMemoryInventory: write wins over inventory keywords', () => {
  const m =
    'Сохрани в базу: а покажи ещё список файлов в базе знаний для справки';
  assert.equal(userAskedToWriteMemory(m), true);
  assert.equal(userAskedForMemoryInventory(m), false);
});

test('shouldUseDeterministicMemoryInventory: off for long multi-paragraph "list" turns', () => {
  const q = 'Какие файлы есть в базе знаний?';
  const long =
    q +
    '\n\n' +
    'x'.repeat(900) +
    '\n\n' +
    'y'.repeat(200);
  assert.equal(userAskedForMemoryInventory(long), true);
  assert.equal(shouldUseDeterministicMemoryInventory(long), false);
});
