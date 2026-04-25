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
    const sys = await getSystemPrompt();
    const seeded = [{ role: 'system', content: sys }, ...history];
    await memory.saveHistory(chatId, seeded);
    return seeded;
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
