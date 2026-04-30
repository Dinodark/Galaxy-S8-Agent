const path = require('path');
const fse = require('fs-extra');
const config = require('../config');
const { chatCompletion } = require('./llm');
const memory = require('./memory');
const tools = require('./tools');
const settings = require('./settings');
const {
  planWriteOrchestration,
  loadProjectsIndex,
  isKnowledgeCoreIndexPath,
} = require('./knowledge_orchestrator');
const {
  userAskedToWriteMemory,
  userAskedForMemoryInventory,
  userWantsKnowledgeDiscussion,
  implicitCaptureFromMedia,
  shouldUseDeterministicMemoryInventory,
  userAskedForReminder,
} = require('./user_intent');
const {
  extractWriteNotePayload,
  stripWriteNoteJsonFences,
} = require('./write_note_recovery');
const {
  extractPrintedToolCall,
  stripPrintedToolInvocations,
} = require('./tool_call_recovery');
const { routeUserIntent, applyRouterMerge } = require('./intent_router');

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

/** Подсказка модели: с голоса чаще нужен write_note, иначе ответ уходит в чат без файла. */
function buildVoiceWriteHint(via, userMessage) {
  const v = String(via || 'text');
  if (!/^(voice|audio|video_note)$/.test(v)) return null;
  const s = String(userMessage || '');
  if (s.length < 40) return null;
  return {
    role: 'system',
    content:
      'This user message is from voice (or video note) transcription. If it contains ' +
      'substantive material to keep (tasks, facts, names, plans, diary, lists) — call ' +
      '`write_note` (append) to the path from the orchestrator block or `inbox.md`. ' +
      'Do not only chat if the user is clearly dumping information to remember. ' +
      'Pure short Q&A without new facts may be answered in text only.',
  };
}

function hasSuccessfulWriteCall(transcript) {
  return transcript.some(
    (item) => item && item.tool === 'write_note' && item.result && item.result.ok
  );
}

async function fallbackSaveUserMessage({
  userMessage,
  toolCtx,
  transcript,
  targetName = 'inbox.md',
}) {
  const stamp = new Date().toISOString();
  const content =
    `## ${stamp}\n` +
    `${String(userMessage || '').trim()}\n\n`;
  const args = {
    name: targetName,
    content,
    append: true,
  };
  const result = await tools.execute('write_note', args, toolCtx);
  transcript.push({
    tool: 'write_note',
    args,
    result,
    fallback: true,
  });
  if (result && result.ok && result.result && result.result.saved) {
    const saved = result.result.saved;
    return `Инбокс: \`memory/notes/${saved}\` (запасная запись).`;
  }
  return (
    'Не удалось сохранить в память автоматически: ' +
    (result && result.error ? result.error : 'unknown error')
  );
}

function renderTreeFromFiles(files) {
  const root = {};
  for (const file of files) {
    const parts = String(file || '').split('/').filter(Boolean);
    let node = root;
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isLeaf = i === parts.length - 1;
      if (isLeaf) {
        node[part] = null;
      } else {
        if (!node[part] || node[part] === null) node[part] = {};
        node = node[part];
      }
    }
  }

  function walk(node, indent) {
    const lines = [];
    const entries = Object.keys(node).sort((a, b) => a.localeCompare(b));
    for (const name of entries) {
      const child = node[name];
      if (child === null) {
        lines.push(`${indent}- ${name}`);
      } else {
        lines.push(`${indent}- ${name}/`);
        lines.push(...walk(child, `${indent}  `));
      }
    }
    return lines;
  }

  return ['memory/', '  notes/', ...walk(root, '    ')].join('\n');
}

function buildMemoryInventoryReply(files) {
  const safeFiles = (files || []).map(String).filter(Boolean).sort((a, b) => a.localeCompare(b));
  if (safeFiles.length === 0) {
    return (
      'Сейчас в базе знаний нет markdown-файлов в `memory/notes`.\n' +
      'Если сводки уже генерировались, появятся как `summaries/summary-YYYY-MM-DD.md`.\n\n' +
      'Проверено через `list_notes` в текущем рантайме. В Telegram можно повторить проверку: `/files`.'
    );
  }
  return (
    'Вот фактическая структура базы знаний (по `list_notes`):\n\n' +
    '```\n' +
    renderTreeFromFiles(safeFiles) +
    '\n```\n\n' +
    `Файлов: ${safeFiles.length}.`
  );
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
  const s = String(text || '');
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match;
  while ((match = fenced.exec(s)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* try next fence */
    }
  }
  const trimmed = s.trim();
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      /* ignore */
    }
  }
  return null;
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

/** When the model prints write_note-shaped JSON instead of calling the tool — execute it. Устойчиво к ``` внутри строк. */
function recoverWriteNoteArgs(userMessage, assistantContent) {
  const obj = extractWriteNotePayload(assistantContent);
  if (!obj) return null;
  if (obj.fire_at != null || obj.cron != null) return null;
  const name = typeof obj.name === 'string' ? obj.name.trim() : '';
  const content =
    typeof obj.content === 'string'
      ? obj.content
      : obj.content === null || obj.content === undefined
        ? ''
        : String(obj.content);
  if (!name || content === '') return null;
  const append = obj.append === false ? false : true;
  return { name, content, append };
}

function sanitizeAssistantReplyForTelegram(content) {
  return stripPrintedToolInvocations(stripWriteNoteJsonFences(String(content || '')));
}

function briefWriteNoteReply(result, append) {
  if (!result || !result.ok || !result.result || !result.result.saved) {
    return 'Не удалось записать: ' + (result && result.error ? result.error : 'unknown error');
  }
  const saved = result.result.saved;
  const how = append === false ? 'сохранил' : 'дописал';
  return `Готово: \`memory/notes/${saved}\` — ${how}.`;
}

async function runAgent({ chatId, userMessage, via = 'text' }) {
  await ensureHistorySeeded(chatId);

  const newMessages = [{ role: 'user', content: userMessage }];
  let history = await memory.appendToHistory(chatId, newMessages);

  const toolSchemas = tools.listSchemas();
  const transcript = [];
  const toolCtx = { chatId };
  const turnContext = [];

  const hWrite = userAskedToWriteMemory(userMessage);
  const hImplicit = implicitCaptureFromMedia(via, userMessage);
  const hKd = userWantsKnowledgeDiscussion(userMessage);

  let routeResult = { ok: false, skipped: true };
  try {
    routeResult = await routeUserIntent(userMessage);
  } catch (e) {
    routeResult = {
      ok: false,
      error: e && e.message ? e.message : String(e),
    };
  }

  const irCfg = config.agent.intentRouter || {};
  const routerMinConf =
    typeof irCfg.minConfidence === 'number' &&
    Number.isFinite(irCfg.minConfidence)
      ? irCfg.minConfidence
      : 0.38;

  const merged = applyRouterMerge(
    hWrite,
    hImplicit,
    hKd,
    routeResult,
    routerMinConf
  );
  let writeIntent = merged.writeIntent;
  let knowledgeDiscussion = merged.knowledgeDiscussion;

  let orchestration = null;

  if (writeIntent) {
    try {
      const s = await settings.getSettings();
      if (s.knowledge && s.knowledge.orchestrator !== false) {
        const files = await memory.listNotes();
        const index = await loadProjectsIndex();
        orchestration = planWriteOrchestration(userMessage, files, index);
        if (orchestration.systemMessage) {
          turnContext.push({ role: 'system', content: orchestration.systemMessage });
        }
      }
    } catch {
      // orchestration is optional; never block the turn
    }
  }

  const voiceHint = buildVoiceWriteHint(via, userMessage);
  if (voiceHint) {
    turnContext.push(voiceHint);
  }

  if (shouldUseDeterministicMemoryInventory(userMessage) && !knowledgeDiscussion) {
    const inventory = await buildMemoryInventoryContext(toolCtx);
    const files = Array.isArray(inventory.result.files) ? inventory.result.files : [];
    transcript.push({
      tool: 'list_notes',
      args: {},
      result: inventory.result,
      grounded: true,
    });
    turnContext.push(inventory.message);

    const deterministicReply = buildMemoryInventoryReply(files);
    history = await memory.appendToHistory(chatId, [{ role: 'assistant', content: deterministicReply }]);
    return {
      reply: deterministicReply,
      toolCalls: transcript,
      steps: 1,
    };
  }

  if (
    knowledgeDiscussion ||
    (userAskedForMemoryInventory(userMessage) &&
      !shouldUseDeterministicMemoryInventory(userMessage))
  ) {
    const inventory = await buildMemoryInventoryContext(toolCtx);
    transcript.push({
      tool: 'list_notes',
      args: {},
      result: inventory.result,
      grounded: true,
      preloaded: true,
    });
    turnContext.push(inventory.message);
  }

  for (let step = 0; step < config.agent.maxSteps; step++) {
    const { message: assistantMsg } = await chatCompletion({
      messages: [...withRuntimeContext(history), ...turnContext],
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

    const printedTool = extractPrintedToolCall(assistantMsg.content || '');
    if (printedTool) {
      const { name: toolName, args: toolArgs } = printedTool;
      const result = await tools.execute(toolName, toolArgs, toolCtx);
      transcript.push({
        tool: toolName,
        args: toolArgs,
        result,
        recoveredFromText: true,
      });
      const fakeId = `recover_${step}_${Date.now()}`;
      const stripped = stripPrintedToolInvocations(stripWriteNoteJsonFences(assistantMsg.content || ''));
      const assistantContent =
        stripped && stripped.trim().length > 0 ? stripped.trim() : null;
      history = await memory.appendToHistory(chatId, [
        {
          role: 'assistant',
          content: assistantContent,
          tool_calls: [
            {
              id: fakeId,
              type: 'function',
              function: {
                name: toolName,
                arguments: JSON.stringify(toolArgs || {}),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: fakeId,
          name: toolName,
          content: JSON.stringify(result).slice(0, 8000),
        },
      ]);
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

    /** Без записи или implicit-capture-intent не исполняем JSON write_note из ответа. */
    const allowWriteNoteRecovery =
      writeIntent || hImplicit;

    const recoveredWriteArgs =
      allowWriteNoteRecovery && !hasSuccessfulWriteCall(transcript)
        ? recoverWriteNoteArgs(userMessage, assistantMsg.content)
        : null;
    if (recoveredWriteArgs) {
      let nameForWrite = recoveredWriteArgs.name.trim();
      if (isKnowledgeCoreIndexPath(memory.sanitizeName(nameForWrite))) {
        nameForWrite = 'inbox.md';
      }
      const execArgs = {
        name: nameForWrite,
        content: recoveredWriteArgs.content,
        append: recoveredWriteArgs.append,
      };
      const result = await tools.execute('write_note', execArgs, toolCtx);
      transcript.push({
        tool: 'write_note',
        args: execArgs,
        result,
        recoveredFromJson: true,
      });
      if (!(result && result.ok)) {
        const errText = result && result.error ? String(result.error) : 'ошибка';
        const reply =
          `В ответе был JSON как у write_note, но запись не прошла: ${errText}. Попробуй ещё раз или сформулируй короче.`;
        history = await memory.appendToHistory(chatId, [{ role: 'assistant', content: reply }]);
        return {
          reply,
          toolCalls: transcript,
          steps: step + 1,
        };
      }
      const reply = briefWriteNoteReply(result, execArgs.append);
      history = await memory.appendToHistory(chatId, [{ role: 'assistant', content: reply }]);
      return {
        reply,
        toolCalls: transcript,
        steps: step + 1,
      };
    }

    if (
      (writeIntent || hImplicit) &&
      !hasSuccessfulWriteCall(transcript)
    ) {
      let targetName = (orchestration && orchestration.fallbackName) || 'inbox.md';
      if (isKnowledgeCoreIndexPath(targetName)) targetName = 'inbox.md';
      const reply = await fallbackSaveUserMessage({
        userMessage,
        toolCtx,
        transcript,
        targetName,
      });
      history = await memory.appendToHistory(chatId, [{ role: 'assistant', content: reply }]);
      return {
        reply,
        toolCalls: transcript,
        steps: step + 1,
      };
    }

    const replyClean = sanitizeAssistantReplyForTelegram(assistantMsg.content || '');
    history = await memory.appendToHistory(chatId, [{ role: 'assistant', content: replyClean }]);
    return {
      reply: replyClean,
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

module.exports = {
  runAgent,
  userAskedToWriteMemory,
  shouldUseDeterministicMemoryInventory,
  userAskedForReminder,
  buildMemoryInventoryReply,
};
