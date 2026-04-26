const test = require('node:test');
const assert = require('node:assert');
const {
  planWriteOrchestration,
  parseIndexContent,
  isKnowledgeCoreIndexPath,
} = require('../core/knowledge_orchestrator');

test('isKnowledgeCoreIndexPath blocks only the routing core', () => {
  assert.equal(isKnowledgeCoreIndexPath('projects/_index.md'), true);
  assert.equal(isKnowledgeCoreIndexPath('projects/dinodark.md'), false);
});

test('parseIndexContent skips self-route for core file', () => {
  const m = parseIndexContent('projects/_index.md | this, should, skip');
  assert.equal(m.has('projects/_index.md'), false);
});

test('parseIndexContent reads path|keywords', () => {
  const c =
    'projects/dinodark.md | динодарк, dinodark.ru\ngarbage no pipe\n# comment\n';
  const m = parseIndexContent(c);
  assert.equal(m.get('projects/dinodark.md')?.has('динодарк'), true);
  assert.equal(m.get('projects/dinodark.md')?.has('dinodark.ru'), true);
});

test('planWrite: single strong project → that file and update intent', () => {
  const plan = planWriteOrchestration(
    'запиши в динодарк: тестовая строка для whisper',
    ['projects/dinodark.md'],
    'projects/dinodark.md | динодарк, dinodark, dinodark.ru'
  );
  assert.equal(plan.intent, 'update_existing_project');
  assert.ok(['high', 'medium'].includes(plan.confidence));
  assert.equal(plan.fallbackName, 'projects/dinodark.md');
  assert.match(plan.systemMessage, /write_note/);
});

test('planWrite: two projects close → cross-link and inbox fallback', () => {
  const plan = planWriteOrchestration(
    'запиши: pupumpa и dinodark оба делаем интеграцию с z',
    [
      'projects/dinodark.md',
      'projects/pupumpa.md',
    ],
    'projects/dinodark.md | динодарк, dinodark\nprojects/pupumpa.md | pupumpa, пупумпа'
  );
  assert.equal(plan.intent, 'cross_project_link');
  assert.equal(plan.fallbackName, 'inbox.md');
  assert.equal(plan.confidence, 'low');
});

test('planWrite: no index but files on disk → basename match', () => {
  const plan = planWriteOrchestration('добавь в pupumpa мем про курсы', [
    'projects/pupumpa.md',
  ], '');
  assert.equal(plan.fallbackName, 'projects/pupumpa.md');
  assert.equal(plan.intent, 'update_existing_project');
});
