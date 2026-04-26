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

function userAskedForMemoryInventory(text) {
  const s = String(text || '').toLowerCase();
  const asksWrite = userAskedToWriteMemory(s);
  const asksInventory =
    /какие|какой|какая|какое|список|покажи|показать|структур|дерев|что\s+есть|где\s+файл|какие\s+файл|memory|notes|list|что\s+в\s+базе/.test(s) &&
    /файл|замет|баз[ауы]\s+знан|memory|notes/.test(s);
  return asksInventory && !asksWrite;
}

function userAskedToWriteMemory(text) {
  return /созда(й|ть)|запиши|сохрани|добавь|добавить|внеси|занеси|разнеси|заполни|сформируй|сделай|создай\s+файл|создай\s+структур|внеси\s+туда|сохрани\s+это|запомни\s+это/.test(
    String(text || '').toLowerCase()
  );
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
    return `Сохранил в память: \`memory/notes/${result.result.saved}\`.\n(Фолбэк-сохранение, потому что модель не вызвала write_note сама.)`;
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
      'Есть только авто-сводки, если они уже сгенерированы.\n\n' +
      'Проверено через `list_notes` в текущем рантайме.'
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
  const turnContext = [];
  const writeIntent = userAskedToWriteMemory(userMessage);
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

  if (userAskedForMemoryInventory(userMessage)) {
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

  for (let step = 0; step < config.agent.maxSteps; step++) {
    const assistantMsg = await chatCompletion({
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
    if (writeIntent && !hasSuccessfulWriteCall(transcript)) {
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
