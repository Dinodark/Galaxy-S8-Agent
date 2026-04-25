const path = require('path');
const fse = require('fs-extra');
const config = require('../config');
const { chatCompletion } = require('./llm');
const memory = require('./memory');
const tools = require('./tools');

let cachedSystemPrompt = null;
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

  const toolSchemas = tools.listSchemas();
  const transcript = [];
  const toolCtx = { chatId };

  for (let step = 0; step < config.agent.maxSteps; step++) {
    const assistantMsg = await chatCompletion({
      messages: withRuntimeContext(history),
      tools: toolSchemas,
    });

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
