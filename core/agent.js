const path = require('path');
const fse = require('fs-extra');
const config = require('../config');
const { chatCompletion } = require('./llm');
const memory = require('./memory');
const tools = require('./tools');

let cachedSystemPrompt = null;

function debugLog(hypothesisId, location, message, data) {
  if (typeof fetch !== 'function') return;
  fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '047796',
    },
    body: JSON.stringify({
      sessionId: '047796',
      runId: 'pre-fix',
      hypothesisId,
      location,
      message,
      data,
      timestamp: Date.now(),
    }),
  }).catch(() => {});
}

async function getSystemPrompt() {
  if (cachedSystemPrompt) return cachedSystemPrompt;
  const p = path.join(__dirname, 'prompts', 'system.md');
  cachedSystemPrompt = await fse.readFile(p, 'utf8');
  return cachedSystemPrompt;
}

async function ensureHistorySeeded(chatId) {
  const history = await memory.loadHistory(chatId);
  const sys = await getSystemPrompt();
  const existingSystem = history[0] && history[0].role === 'system'
    ? history[0].content || ''
    : '';
  if (history.length === 0 || history[0].role !== 'system') {
    const seeded = [{ role: 'system', content: sys }, ...history];
    await memory.saveHistory(chatId, seeded);
    return seeded;
  }
  if (existingSystem !== sys) {
    const updated = [{ role: 'system', content: sys }, ...history.slice(1)];
    await memory.saveHistory(chatId, updated);
    return updated;
  }
  return history;
}

function buildRuntimeContextMessage() {
  const now = new Date();
  let tz = 'unknown';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
  } catch {
    // ignore
  }
  return {
    role: 'system',
    content:
      'Runtime context (fresh each turn, not stored in history):\n' +
      `- current_time_utc: ${now.toISOString()}\n` +
      `- current_time_local: ${now.toString()}\n` +
      `- timezone: ${tz}\n` +
      'Use this value to compute ISO timestamps for tools like reminder_add ' +
      'when the user says things like "in 10 min", "tomorrow at 6pm", "через час".',
  };
}

function withRuntimeContext(history) {
  const ctx = buildRuntimeContextMessage();
  if (history.length === 0) return [ctx];
  if (history[0] && history[0].role === 'system') {
    return [history[0], ctx, ...history.slice(1)];
  }
  return [ctx, ...history];
}

function userAskedForReminder(text) {
  return /\bremind\b|напомни|напомин/i.test(String(text || ''));
}

function userAskedForMemoryInventory(text) {
  return /файл|замет|структур|дерев|баз[ауы]\s+знан|memory|notes|list/i.test(String(text || ''));
}

async function buildMemoryInventoryContext(toolCtx) {
  const result = await tools.execute('list_notes', {}, toolCtx);
  const files = Array.isArray(result.files) ? result.files : [];
  return {
    result,
    message: {
      role: 'system',
      content:
        'Fresh memory inventory for this turn from list_notes:\n' +
        (files.length > 0
          ? files.map((file) => `- ${file}`).join('\n')
          : '- No markdown note files currently exist under memory/notes.\n') +
        '\nWhen answering questions about existing files, notes, folders, or the knowledge-base tree, use ONLY this inventory. Do not invent files, folders, images, or prototypes. If the inventory is empty, say plainly that no note files exist yet.',
    },
  };
}

function extractJsonObjectFromMarkdown(text) {
  const s = String(text || '').trim();
  const fenced = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```/i);
  const raw = fenced ? fenced[1] : s;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}

function recoverReminderArgs(userMessage, assistantContent) {
  if (!userAskedForReminder(userMessage)) return null;
  const obj = extractJsonObjectFromMarkdown(assistantContent);
  if (!obj || typeof obj.text !== 'string') return null;
  if (!obj.fire_at && !obj.cron) return null;
  return {
    text: obj.text,
    fire_at: obj.fire_at || null,
    cron: obj.cron || null,
    tz: obj.tz || null,
    until: obj.until || null,
    max_count: obj.max_count == null ? null : obj.max_count,
  };
}

function recoveredReminderReply(result) {
  if (!result || !result.ok || !result.result) {
    return 'Не смог поставить напоминание: ' + (result && result.error ? result.error : 'unknown error');
  }
  const r = result.result;
  const when = new Date(r.fire_at).toLocaleString('ru-RU', {
    hour12: false,
  });
  return `Напоминание установлено: ${r.text}\nКогда: ${when}\nID: ${r.id}`;
}

async function runAgent({ chatId, userMessage }) {
  await ensureHistorySeeded(chatId);

  const newMessages = [{ role: 'user', content: userMessage }];
  let history = await memory.appendToHistory(chatId, newMessages);

  // #region agent log
  debugLog('H1,H4', 'core/agent.js:runAgent:start', 'agent turn started', {
    chatId,
    historyLength: history.length,
    userMessageLength: String(userMessage || '').length,
    asksAboutFiles: /файл|замет|структур|дерев|memory|notes|list/i.test(String(userMessage || '')),
  });
  // #endregion

  const toolSchemas = tools.listSchemas();
  const transcript = [];
  const toolCtx = { chatId };
  const turnContext = [];

  if (userAskedForMemoryInventory(userMessage)) {
    const inventory = await buildMemoryInventoryContext(toolCtx);
    transcript.push({
      tool: 'list_notes',
      args: {},
      result: inventory.result,
      grounded: true,
    });
    turnContext.push(inventory.message);

    // #region agent log
    debugLog('H1,H2,H4', 'core/agent.js:runAgent:memoryInventoryContext', 'memory inventory injected', {
      fileCount: Array.isArray(inventory.result.files) ? inventory.result.files.length : null,
      files: Array.isArray(inventory.result.files) ? inventory.result.files.slice(0, 50) : null,
    });
    // #endregion
  }

  for (let step = 0; step < config.agent.maxSteps; step++) {
    const assistantMsg = await chatCompletion({
      messages: [...withRuntimeContext(history), ...turnContext],
      tools: toolSchemas,
    });

    // #region agent log
    debugLog('H1,H3,H4', 'core/agent.js:runAgent:assistantResponse', 'assistant response received', {
      step,
      hasToolCalls: Boolean(assistantMsg.tool_calls && assistantMsg.tool_calls.length),
      toolCallNames: (assistantMsg.tool_calls || []).map((call) => call.function && call.function.name),
      contentLength: String(assistantMsg.content || '').length,
      contentLooksLikeFileTree: /memory|notes|projects\/|```|Дерево базы/i.test(String(assistantMsg.content || '')),
      transcriptToolNames: transcript.map((item) => item.tool),
    });
    // #endregion

    const pushed = [assistantMsg];

    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const call of assistantMsg.tool_calls) {
        const name = call.function && call.function.name;
        let args = {};
        try {
          args = call.function && call.function.arguments
            ? JSON.parse(call.function.arguments)
            : {};
        } catch (e) {
          args = {};
        }

        const result = await tools.execute(name, args, toolCtx);
        transcript.push({ tool: name, args, result });

        // #region agent log
        debugLog('H2,H3', 'core/agent.js:runAgent:toolResult', 'tool executed', {
          step,
          tool: name,
          argKeys: Object.keys(args || {}),
          resultFound: result && result.found,
          resultFileCount: result && Array.isArray(result.files) ? result.files.length : null,
          resultFiles: result && Array.isArray(result.files) ? result.files.slice(0, 30) : undefined,
          saved: result && result.saved,
          ok: result && result.ok,
        });
        // #endregion

        pushed.push({
          role: 'tool',
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }

      history = await memory.appendToHistory(chatId, pushed);
      continue;
    }

    const recoveredReminder = recoverReminderArgs(userMessage, assistantMsg.content);
    if (recoveredReminder) {
      const result = await tools.execute('reminder_add', recoveredReminder, toolCtx);
      transcript.push({
        tool: 'reminder_add',
        args: recoveredReminder,
        result,
        recovered: true,
      });
      const reply = recoveredReminderReply(result);
      history = await memory.appendToHistory(chatId, [{ role: 'assistant', content: reply }]);
      return {
        reply,
        toolCalls: transcript,
        steps: step + 1,
      };
    }

    history = await memory.appendToHistory(chatId, pushed);
    // #region agent log
    debugLog('H1,H3,H4', 'core/agent.js:runAgent:finalReply', 'final reply without tool calls', {
      step,
      transcriptToolNames: transcript.map((item) => item.tool),
      replyLength: String(assistantMsg.content || '').length,
      replyLooksLikeFileTree: /memory|notes|projects\/|```|Дерево базы/i.test(String(assistantMsg.content || '')),
    });
    // #endregion
    return {
      reply: assistantMsg.content || '',
      toolCalls: transcript,
      steps: step + 1,
    };
  }

  const fallback = {
    role: 'assistant',
    content:
      '(Agent reached max steps without final answer. Please rephrase or simplify the request.)',
  };
  await memory.appendToHistory(chatId, [fallback]);
  return { reply: fallback.content, toolCalls: transcript, steps: config.agent.maxSteps };
}

module.exports = { runAgent };
