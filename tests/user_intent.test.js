const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  userAskedToWriteMemory,
  userAskedForMemoryInventory,
  userWantsKnowledgeDiscussion,
  userAskedForReminder,
  implicitCaptureFromMedia,
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

test('userAskedForMemoryInventory: проекты в работе (какие + проект)', () => {
  const q = 'Какие у нас проекты в работе сейчас?';
  assert.equal(userAskedForMemoryInventory(q), true);
  assert.equal(userWantsKnowledgeDiscussion(q), true);
  assert.equal(userAskedToWriteMemory(q), false);
});

test('userAskedForMemoryInventory: опечатка в слове проекты, но «работе» держит тему', () => {
  const q = 'Скажи, какие проеуты у нас в работе?';
  assert.equal(userAskedForMemoryInventory(q), true);
  assert.equal(userWantsKnowledgeDiscussion(q), true);
});

test('userAskedForMemoryInventory: "полный список" without the word "файл"', () => {
  const q1 = 'дай полный список';
  const q2 = 'какие у нас есть файлы? дай полный список';
  assert.equal(userAskedForMemoryInventory(q1), true);
  assert.equal(userAskedForMemoryInventory(q2), true);
  assert.equal(userAskedToWriteMemory(q1), false);
});

test('userAskedForMemoryInventory: write wins over inventory keywords', () => {
  const m =
    'Сохрани в базу: а покажи ещё список файлов в базе знаний для справки';
  assert.equal(userAskedToWriteMemory(m), true);
  assert.equal(userAskedForMemoryInventory(m), false);
});

test('implicitCaptureFromMedia: voice long enough → true', () => {
  const long = 'x'.repeat(100);
  assert.equal(implicitCaptureFromMedia('voice', long), true);
  assert.equal(implicitCaptureFromMedia('text', long), false);
});

test('implicitCaptureFromMedia: medium voice (≥40) non-inventory → true', () => {
  assert.equal(implicitCaptureFromMedia('voice', 'x'.repeat(45)), true);
});

test('implicitCaptureFromMedia: long voice bypasses inventory keywords', () => {
  const mixed =
    'какие у нас проекты в работе расскажи ещё ' + 'y'.repeat(200);
  assert.equal(implicitCaptureFromMedia('voice', mixed), true);
});

test('implicitCaptureFromMedia: too short or inventory query → false', () => {
  assert.equal(implicitCaptureFromMedia('voice', 'short'), false);
  assert.equal(
    implicitCaptureFromMedia('voice', 'какие файлы есть в базе знаний?'),
    false
  );
  const invOnly =
    'какие файлы есть в базе знаний и что в памяти по проектам сейчас? ' +
    'x'.repeat(20);
  assert.equal(implicitCaptureFromMedia('voice', invOnly), false);
});

test('userAskedForReminder: через N дней … уточнить', () => {
  assert.equal(
    userAskedForReminder(
      'через 3 дня уточнить статус задач у фаундера'
    ),
    true
  );
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
