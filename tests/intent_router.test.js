const assert = require('assert');
const {
  applyRouterMerge,
  parseRouterJson,
} = require('../core/intent_router');

function testParseRouterJson() {
  assert.deepStrictEqual(
    parseRouterJson('{"intent":"kb_question","confidence":0.9}'),
    { intent: 'kb_question', confidence: 0.9 }
  );
  assert.deepStrictEqual(
    parseRouterJson('```json\n{"intent":"chat","confidence":0.2}\n```'),
    { intent: 'chat', confidence: 0.2 }
  );
  assert.strictEqual(parseRouterJson(''), null);
}

function testKbQuestionPreservesImplicitCapture() {
  const merged = applyRouterMerge(
    false,
    true,
    false,
    { ok: true, skipped: false, intent: 'kb_question', confidence: 0.9 },
    0.3
  );
  assert.strictEqual(merged.writeIntent, true);
  assert.strictEqual(merged.knowledgeDiscussion, true);
}

function testKbQuestionPureQuestionNoImplicit() {
  const merged = applyRouterMerge(
    false,
    false,
    false,
    { ok: true, skipped: false, intent: 'kb_question', confidence: 0.9 },
    0.3
  );
  assert.strictEqual(merged.writeIntent, false);
  assert.strictEqual(merged.knowledgeDiscussion, true);
}

function testChatPreservesHeuristicKd() {
  const merged = applyRouterMerge(
    false,
    false,
    true,
    { ok: true, skipped: false, intent: 'chat', confidence: 0.9 },
    0.3
  );
  assert.strictEqual(merged.knowledgeDiscussion, true);
}

function testRouterLowConfidenceFallsBack() {
  const merged = applyRouterMerge(
    true,
    false,
    false,
    { ok: true, skipped: false, intent: 'save_to_memory', confidence: 0.1 },
    0.38
  );
  assert.strictEqual(merged.writeIntent, true);
  assert.strictEqual(merged.source.kind, 'router_low_conf');
}

testParseRouterJson();
testKbQuestionPreservesImplicitCapture();
testKbQuestionPureQuestionNoImplicit();
testChatPreservesHeuristicKd();
testRouterLowConfidenceFallsBack();
