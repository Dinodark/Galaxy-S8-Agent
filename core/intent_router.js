const config = require('../config');
const { chatCompletion, OpenRouterError } = require('./llm');

const ALLOWED = new Set([
  'kb_question',
  'save_to_memory',
  'mixed',
  'reminder',
  'chat',
]);

function parseRouterJson(content) {
  const raw = String(content || '').trim();
  if (!raw) return null;
  let text = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    const o = JSON.parse(text);
    if (!o || typeof o !== 'object') return null;
    const intent = String(o.intent || '').trim();
    const confidence =
      typeof o.confidence === 'number' && !Number.isNaN(o.confidence)
        ? Math.max(0, Math.min(1, o.confidence))
        : null;
    return { intent, confidence };
  } catch {
    return null;
  }
}

/**
 * Слияние regex-эвристик с результатом routeUserIntent (при высокой уверенности).
 * Если implicit voice capture без явного «запиши» — kb_question не отключает запись в память.
 */
function applyRouterMerge(hWrite, hImplicit, hKd, route, minConf) {
  let writeIntent = Boolean(hWrite || hImplicit);
  let knowledgeDiscussion = Boolean(hKd);
  /** @type {{ kind: 'heuristic' | 'router' | 'router_low_conf', intent?: string, confidence?: number }} */
  const source = { kind: 'heuristic' };

  if (!route || !route.ok || route.skipped || route.error) {
    return { writeIntent, knowledgeDiscussion, source };
  }
  const conf = typeof route.confidence === 'number' ? route.confidence : 0;
  const intentOk = ALLOWED.has(String(route.intent || ''));
  if (!intentOk || conf < minConf) {
    source.kind = 'router_low_conf';
    source.confidence = conf;
    if (route.intent) source.intent = route.intent;
    return { writeIntent, knowledgeDiscussion, source };
  }

  const intent = route.intent;
  source.kind = 'router';
  source.intent = intent;
  source.confidence = conf;

  switch (intent) {
    case 'kb_question':
      knowledgeDiscussion = true;
      if (hImplicit && !hWrite) {
        writeIntent = true;
      } else {
        writeIntent = Boolean(hWrite);
      }
      break;
    case 'save_to_memory':
      writeIntent = true;
      break;
    case 'mixed':
      knowledgeDiscussion = true;
      writeIntent = true;
      break;
    case 'reminder':
      /* Avoid pulling knowledge write orchestrator when routing is confidently about alarms / calendar slots. */
      writeIntent = false;
      knowledgeDiscussion = Boolean(hKd);
      break;
    case 'chat':
      knowledgeDiscussion = Boolean(hKd);
      writeIntent = Boolean(hWrite || hImplicit);
      break;
    default:
      break;
  }
  return { writeIntent, knowledgeDiscussion, source };
}

async function routeUserIntent(userMessage) {
  const ir = config.agent && config.agent.intentRouter;
  if (!ir || !ir.enabled) {
    return { ok: false, skipped: true };
  }
  const model =
    ir.model && String(ir.model).trim() !== ''
      ? String(ir.model).trim()
      : config.openrouter.model;
  const timeoutMs =
    typeof ir.timeoutMs === 'number' && Number.isFinite(ir.timeoutMs)
      ? ir.timeoutMs
      : 25000;

  const system = `You classify the user's message into exactly one intent. Reply with JSON only.
Schema: {"intent":"kb_question"|"save_to_memory"|"mixed"|"reminder"|"chat","confidence":number}
confidence must be between 0 and 1 inclusive.

- kb_question: asking about knowledge base / memory content / what was saved / listing notes / searching
- save_to_memory: explicit request to save, remember, or write a note
- mixed: both a KB/memory question and a save in one message
- reminder: alarms, reminders, "remind me", relative time like "in 10 minutes";
  also weekly schedules ("every Monday"), days of week in Russian ("по понедельникам"),
  "add to calendar", recurring events / class times
- chat: casual chat, greetings, unrelated talk without primary KB/save focus

When unsure, prefer "chat" with confidence below 0.4.`;

  const userText = String(userMessage || '').slice(0, 12000);

  async function completion(withJsonMode) {
    return chatCompletion({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userText },
      ],
      temperature: 0,
      response_format: withJsonMode ? { type: 'json_object' } : undefined,
      timeoutMs,
      debugContext: { scope: 'intent_router' },
    });
  }

  let message;
  let usage;

  try {
    ({ message, usage } = await completion(true));
  } catch (e1) {
    const fallback =
      e1 instanceof OpenRouterError &&
      e1.status != null &&
      e1.status >= 400 &&
      e1.status < 500;
    if (!fallback) {
      return {
        ok: false,
        error: e1 && e1.message ? e1.message : String(e1),
      };
    }
    try {
      ({ message, usage } = await completion(false));
    } catch (e2) {
      return {
        ok: false,
        error: e2 && e2.message ? e2.message : String(e2),
      };
    }
  }

  const content = message && message.content ? message.content : '';
  const parsed = parseRouterJson(content);
  if (!parsed || !parsed.intent) {
    return {
      ok: false,
      error: 'parse_failed',
      raw: content,
    };
  }
  let intent = String(parsed.intent).trim();
  if (!ALLOWED.has(intent)) {
    intent = 'chat';
  }
  const confidence =
    parsed.confidence != null ? parsed.confidence : 0.45;
  const conf = Math.max(0, Math.min(1, Number(confidence)));

  return {
    ok: true,
    skipped: false,
    intent,
    confidence: conf,
    usage: usage || null,
  };
}

module.exports = {
  routeUserIntent,
  applyRouterMerge,
  parseRouterJson,
  ALLOWED,
};
