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
  console.log('[debug:047796] current system prompt file', {
    chatId,
    chars: sys.length,
    reminderAddIndex: sys.indexOf('reminder_add'),
    reminderListIndex: sys.indexOf('reminder_list'),
    reminderSnippet: sys.slice(
      Math.max(0, sys.indexOf('reminder') - 80),
      sys.indexOf('reminder') < 0 ? 0 : sys.indexOf('reminder') + 180
    ),
  });
  const existingSystem = history[0] && history[0].role === 'system'
    ? history[0].content || ''
    : '';
  // #region agent log
  fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'047796'},body:JSON.stringify({sessionId:'047796',runId:'pre-fix',hypothesisId:'H6',location:'core/agent.js:ensureHistorySeeded',message:'loaded chat history system prompt state',data:{chatId,historyLength:history.length,hasSystem:!!existingSystem,systemHasReminderAdd:existingSystem.includes('reminder_add'),systemHasSettingsCenter:existingSystem.includes('Settings Center'),systemChars:existingSystem.length},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  if (existingSystem) {
    console.log('[debug:047796] history system prompt', {
      chatId,
      historyLength: history.length,
      systemHasReminderAdd: existingSystem.includes('reminder_add'),
      systemHasSettingsCenter: existingSystem.includes('Settings Center'),
      systemChars: existingSystem.length,
    });
  }
  if (history.length === 0 || history[0].role !== 'system') {
    const seeded = [{ role: 'system', content: sys }, ...history];
    await memory.saveHistory(chatId, seeded);
    // #region agent log
    fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'047796'},body:JSON.stringify({sessionId:'047796',runId:'post-fix',hypothesisId:'H6',location:'core/agent.js:ensureHistorySeeded.seed',message:'seeded current system prompt into history',data:{chatId,historyLength:seeded.length,systemHasReminderAdd:sys.includes('reminder_add'),systemHasSettingsCenter:sys.includes('Settings Center'),systemChars:sys.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    console.log('[debug:047796] seeded current system prompt', {
      chatId,
      historyLength: seeded.length,
      systemHasReminderAdd: sys.includes('reminder_add'),
      systemHasSettingsCenter: sys.includes('Settings Center'),
      systemChars: sys.length,
    });
    return seeded;
  }
  if (existingSystem !== sys) {
    const updated = [{ role: 'system', content: sys }, ...history.slice(1)];
    await memory.saveHistory(chatId, updated);
    // #region agent log
    fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'047796'},body:JSON.stringify({sessionId:'047796',runId:'post-fix',hypothesisId:'H6',location:'core/agent.js:ensureHistorySeeded.refresh',message:'refreshed stale system prompt in history',data:{chatId,historyLength:updated.length,beforeHasReminderAdd:existingSystem.includes('reminder_add'),afterHasReminderAdd:sys.includes('reminder_add'),beforeHasSettingsCenter:existingSystem.includes('Settings Center'),afterHasSettingsCenter:sys.includes('Settings Center'),beforeChars:existingSystem.length,afterChars:sys.length},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    console.log('[debug:047796] refreshed system prompt', {
      chatId,
      historyLength: updated.length,
      beforeHasReminderAdd: existingSystem.includes('reminder_add'),
      afterHasReminderAdd: sys.includes('reminder_add'),
      beforeHasSettingsCenter: existingSystem.includes('Settings Center'),
      afterHasSettingsCenter: sys.includes('Settings Center'),
      beforeChars: existingSystem.length,
      afterChars: sys.length,
    });
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
  console.log('[debug:047796] tool schemas before LLM', {
    chatId,
    toolCount: toolSchemas.length,
    hasReminderAdd: toolSchemas.some((t) => t.function && t.function.name === 'reminder_add'),
    reminderTools: toolSchemas
      .map((t) => t.function && t.function.name)
      .filter((name) => name && name.startsWith('reminder_')),
  });
  const transcript = [];
  const toolCtx = { chatId };

  for (let step = 0; step < config.agent.maxSteps; step++) {
    const assistantMsg = await chatCompletion({
      messages: withRuntimeContext(history),
      tools: toolSchemas,
    });
    console.log('[debug:047796] LLM response', {
      chatId,
      step,
      hasToolCalls: !!(assistantMsg.tool_calls && assistantMsg.tool_calls.length),
      toolCallNames: (assistantMsg.tool_calls || []).map((c) => c.function && c.function.name),
      contentLooksLikeJson: String(assistantMsg.content || '').trim().startsWith('```json'),
      contentPreview: String(assistantMsg.content || '').slice(0, 260),
    });
    // #region agent log
    fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'047796'},body:JSON.stringify({sessionId:'047796',runId:'pre-fix',hypothesisId:'H1,H2',location:'core/agent.js:after-chatCompletion',message:'assistant response from LLM',data:{chatId,step,hasToolCalls:!!(assistantMsg.tool_calls&&assistantMsg.tool_calls.length),toolCallNames:(assistantMsg.tool_calls||[]).map((c)=>c.function&&c.function.name),contentPreview:String(assistantMsg.content||'').slice(0,500)},timestamp:Date.now()})}).catch(()=>{});
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

        if (name && name.startsWith('reminder_')) {
          // #region agent log
          fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'047796'},body:JSON.stringify({sessionId:'047796',runId:'pre-fix',hypothesisId:'H1,H2,H5',location:'core/agent.js:before-tools.execute',message:'agent requested reminder tool',data:{chatId,tool:name,args},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }
        const result = await tools.execute(name, args, toolCtx);
        if (name && name.startsWith('reminder_')) {
          // #region agent log
          fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'047796'},body:JSON.stringify({sessionId:'047796',runId:'pre-fix',hypothesisId:'H1,H2,H5',location:'core/agent.js:after-tools.execute',message:'reminder tool result returned to agent',data:{chatId,tool:name,result},timestamp:Date.now()})}).catch(()=>{});
          // #endregion
        }
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
      console.log('[debug:047796] recovering fake reminder JSON', {
        chatId,
        step,
        args: recoveredReminder,
      });
      // #region agent log
      fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'047796'},body:JSON.stringify({sessionId:'047796',runId:'post-fix',hypothesisId:'H7',location:'core/agent.js:recoverReminderArgs',message:'recovering content-only reminder JSON as real tool call',data:{chatId,step,args:recoveredReminder},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const result = await tools.execute('reminder_add', recoveredReminder, toolCtx);
      console.log('[debug:047796] recovered reminder_add result', {
        chatId,
        step,
        ok: result && result.ok,
        result,
      });
      // #region agent log
      fetch('http://127.0.0.1:7933/ingest/05d097ed-198e-47e6-8b77-1f7ddf4809a1',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'047796'},body:JSON.stringify({sessionId:'047796',runId:'post-fix',hypothesisId:'H7,H3',location:'core/agent.js:recoverReminderResult',message:'fake reminder JSON recovery result',data:{chatId,step,result},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
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
