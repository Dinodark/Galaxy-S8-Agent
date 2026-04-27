const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const axios = require('axios');
const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const { runAgent, buildMemoryInventoryReply } = require('../core/agent');
const { checkKey } = require('../core/llm');
const stt = require('../core/stt');
const memory = require('../core/memory');
const reminders = require('../core/reminders');
const journal = require('../core/journal');
const modes = require('../core/modes');
const settings = require('../core/settings');
const runtime = require('../core/runtime');
const atlas = require('../core/memory_atlas');
const { localIpCandidates } = require('../core/web_server');
const { startBatteryWatcher } = require('../core/watchers/battery');
const { runReview } = require('../core/watchers/daily_review');
const { isAllowed } = require('./auth');

const SILENT_REACTION = '✍';

/** Private chat: merge rapid-fire text parts (long Telegram messages are split) before runAgent. */
const textCoalesceState = new Map();
const runChatSerialized = new Map();

function runSerialized(chatId, fn) {
  const prev = runChatSerialized.get(chatId) || Promise.resolve();
  const next = prev.then(() => fn());
  runChatSerialized.set(chatId, next);
  return next.catch((err) => {
    console.error('[telegram] serialized handler error:', err);
  });
}

/**
 * Buffers `text` with prior parts for this chat, flushes `coalesceMs` after the last part.
 * Silent mode should call handleUserMessage directly, not this.
 */
function scheduleCoalescedTextMessage(chatId, text, { coalesceMs, onFlush }) {
  if (!coalesceMs || coalesceMs <= 0) {
    return runSerialized(chatId, () => onFlush(String(text || '')));
  }
  const t = String(text || '');
  let st = textCoalesceState.get(chatId);
  if (!st) {
    st = { parts: [], timer: null };
    textCoalesceState.set(chatId, st);
  }
  st.parts.push(t);
  if (st.timer) {
    clearTimeout(st.timer);
    st.timer = null;
  }
  st.timer = setTimeout(() => {
    st = textCoalesceState.get(chatId);
    if (!st || st.parts.length === 0) return;
    const combined = st.parts.join('\n\n');
    const n = st.parts.length;
    if (st.timer) {
      clearTimeout(st.timer);
      st.timer = null;
    }
    textCoalesceState.delete(chatId);
    if (n > 1) {
      console.log(
        `[telegram] coalesced ${n} text parts for chat ${chatId} (total ${combined.length} chars)`
      );
    }
    return runSerialized(chatId, () => onFlush(combined));
  }, coalesceMs);
}

async function notifyInboxTriageResult(bot, chatId, result) {
  const t = result && result.triage;
  if (!t || t.skipped) return;
  if (t.cleared) {
    await bot.sendMessage(
      chatId,
      'Инбокс: ночной разбор выполнен, очередь очищена; снимок за день в архиве.'
    );
  } else if (t.error) {
    await bot.sendMessage(
      chatId,
      'Инбокс: разбор прервался — сам файл инбокса не трогал. Снимок перед разбором в архиве на случай сбоя.'
    );
  }
}

async function setReaction(chatId, messageId, emoji) {
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.telegram.token}/setMessageReaction`,
      {
        chat_id: chatId,
        message_id: messageId,
        reaction: [{ type: 'emoji', emoji }],
      },
      { timeout: 10_000, validateStatus: () => true }
    );
  } catch (err) {
    console.warn('[telegram] setMessageReaction failed:', err.message);
  }
}

function start() {
  try {
    const { ensureKnowledgeTree } = require('../core/bootstrap_knowledge');
    ensureKnowledgeTree().catch((e) =>
      console.warn('[knowledge] bootstrap failed:', e.message)
    );
  } catch (e) {
    console.warn('[knowledge] bootstrap require failed:', e.message);
  }

  const bot = new TelegramBot(config.telegram.token, { polling: true });
  let dailyReviewController = null;

  bot.on('polling_error', (err) => {
    console.error('[telegram] polling_error:', err.message);
  });

  bot.onText(/^\/start$/, async (msg) => {
    const id = msg.from && msg.from.id;
    if (!isAllowed(id)) return replyUnauthorized(bot, msg);
    const status = await runtime.buildStatus(msg.chat.id);
    await bot.sendMessage(
      msg.chat.id,
      `Vatoko Galaxy online.\nYour id: ${id}\nMode: ${status.mode}\nModel: ${config.openrouter.model}\nShell: ${
        config.safety.allowShell ? 'enabled' : 'disabled'
      }\nBattery watch: ${
        config.battery.enabled
          ? `on (<${config.battery.lowThreshold}%)`
          : 'off'
      }\nSTT: ${status.stt.enabled ? `on (${config.groq.sttModel})` : 'off'}\nReminders: on (poll ${Math.round(config.reminders.pollIntervalMs / 1000)}s)\nDaily review: ${
        status.dailyReview.enabled
          ? `on (cron "${status.dailyReview.cron}", tz=${status.dailyReview.tz})`
          : 'off'
      }\n\nCommands:\n/status — runtime status\n/files — список всех .md в memory/notes (дерево)\n/settings — Settings Center buttons\n/set — change a setting by name\n/web — local web UI URL\n/atlas — build and send memory mindmap\n/atlas_status — memory atlas stats\n/ping — liveness check\n/diag — OpenRouter key status\n/battery — phone battery status\n/reminders — list pending reminders\n/summary — generate today's evening review now\n/silent — capture only, no replies (auto-exits at evening review)\n/chat — normal conversational mode\n/reset — wipe this chat's history`
    );
  });

  bot.onText(/^\/ping$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    await bot.sendMessage(msg.chat.id, 'pong');
  });

  bot.onText(/^\/reset$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    await memory.resetHistory(msg.chat.id);
    await bot.sendMessage(msg.chat.id, 'History reset.');
  });

  bot.onText(/^\/battery$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      const tool = require('../core/tools').registry.phone_battery;
      const result = await tool.handler({});
      await bot.sendMessage(
        msg.chat.id,
        '```\n' +
          JSON.stringify(result, null, 2).slice(0, 3500) +
          '\n```',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await bot.sendMessage(msg.chat.id, 'battery error: ' + err.message);
    }
  });

  bot.onText(/^\/reminders$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      const items = await reminders.listPending({ chatId: msg.chat.id });
      if (items.length === 0) {
        await bot.sendMessage(msg.chat.id, 'No pending reminders.');
        return;
      }
      const lines = items.map((r, i) => {
        const d = new Date(r.fireAt);
        const when = d.toLocaleString();
        let suffix = '';
        if (r.recurrence && r.recurrence.cron) {
          suffix = ` · every \`${r.recurrence.cron}\` (${r.recurrence.tz})`;
          if (r.maxCount) {
            suffix += ` · ${r.firedCount || 0}/${r.maxCount}`;
          }
          if (r.until) {
            suffix += ` · until ${new Date(r.until).toLocaleString()}`;
          }
        }
        return `${i + 1}. ${when} — ${r.text} \`[${r.id}]\`${suffix}`;
      });
      await bot.sendMessage(msg.chat.id, lines.join('\n'), {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      await bot.sendMessage(msg.chat.id, 'reminders error: ' + err.message);
    }
  });

  bot.onText(/^\/status$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      const status = await runtime.buildStatus(msg.chat.id);
      await bot.sendMessage(msg.chat.id, '```\n' + runtime.formatStatus(status) + '\n```', {
        parse_mode: 'Markdown',
      });
    } catch (err) {
      await bot.sendMessage(msg.chat.id, 'status error: ' + err.message);
    }
  });

  bot.onText(/^\/files$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      const files = await memory.listNotes();
      const text = buildMemoryInventoryReply(files);
      await sendLong(bot, msg.chat.id, text);
    } catch (err) {
      console.error('[files] error:', err);
      await bot.sendMessage(msg.chat.id, 'files error: ' + err.message);
    }
  });

  bot.onText(/^\/atlas$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      await bot.sendChatAction(msg.chat.id, 'upload_document');
      const result = await atlas.buildAtlas({ chatId: msg.chat.id });
      await bot.sendMessage(
        msg.chat.id,
        `Memory atlas built: ${result.index.stats.notes} knowledge files, ${result.index.stats.folders} folders, ${result.index.stats.links} links.`
      );
      await bot.sendDocument(msg.chat.id, result.htmlFile);
    } catch (err) {
      console.error('[atlas] error:', err);
      await bot.sendMessage(msg.chat.id, 'atlas error: ' + err.message);
    }
  });

  bot.onText(/^\/web$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      if (msg.chat.type && msg.chat.type !== 'private') {
        await bot.sendMessage(
          msg.chat.id,
          'Local web UI URL contains a private token. Send /web in a private chat with the bot.'
        );
        return;
      }
      const s = await settings.getSettings();
      const port = s.web.port || 8787;
      const bindHost = String((s.web && s.web.host) || '0.0.0.0');
      const token = encodeURIComponent(s.web.token);
      const phoneUrl = `http://127.0.0.1:${port}/?token=${token}`;
      const candidates = localIpCandidates(5);
      const lines = [
        'Веб-панель (локально):',
        '',
        'Только на этом телефоне (Termux, где крутится агент):',
        phoneUrl,
        '',
        'С другого телефона или ПК адрес 127.0.0.1 не сработает — это «сам на себя».',
        'Нужен IP телефона с агентом в вашей Wi‑Fi. Попробуй по очереди:',
      ];
      if (candidates.length === 0) {
        lines.push('');
        lines.push(
          '(IP не определился. На телефоне с агентом: ip -4 addr — подставь адрес вида 192.168.x.x.)'
        );
      } else {
        candidates.forEach((c, i) => {
          lines.push(`${i + 1}. http://${c.ip}:${port}/?token=${token}  (${c.iface})`);
        });
      }
      lines.push('');
      lines.push('Запуск веба на телефоне с агентом: agent-web (или agent-up).');
      if (bindHost !== '0.0.0.0' && bindHost !== '::') {
        lines.push('');
        lines.push(`Внимание: web.host = ${bindHost}. С других устройств может не открыться.`);
        lines.push('Поставь: /set web_host 0.0.0.0');
      }
      lines.push('');
      lines.push(
        'Проверь: оба устройства в одной Wi‑Fi (не «гость» с изоляцией клиентов). На втором телефоне на время выключи мобильный интернет. Private DNS / VPN могут мешать.'
      );
      lines.push('Безопасность: открывай только в доверенной сети.');
      await bot.sendMessage(msg.chat.id, lines.join('\n'), { disable_web_page_preview: true });
    } catch (err) {
      await bot.sendMessage(msg.chat.id, 'web error: ' + err.message);
    }
  });

  bot.onText(/^\/atlas_status$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      const s = await atlas.status();
      if (!s.exists) {
        await bot.sendMessage(msg.chat.id, 'Memory atlas has not been built yet. Use /atlas.');
        return;
      }
      await bot.sendMessage(
        msg.chat.id,
        [
          `Memory atlas: ${s.generatedAt}`,
          `Knowledge files: ${s.stats.notes}`,
          `Folders: ${s.stats.folders}`,
          `Links: ${s.stats.links}`,
        ].join('\n')
      );
    } catch (err) {
      await bot.sendMessage(msg.chat.id, 'atlas status error: ' + err.message);
    }
  });

  bot.onText(/^\/settings$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      await sendSettingsMenu(bot, msg.chat.id);
    } catch (err) {
      await bot.sendMessage(msg.chat.id, 'settings error: ' + err.message);
    }
  });

  bot.onText(/^\/set(?:\s+(\S+)\s+(.+))?$/, async (msg, match) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    const key = match && match[1];
    const value = match && match[2];
    if (!key || value == null) {
      await bot.sendMessage(
        msg.chat.id,
        [
          'Usage:',
          '/set daily_review_time 22:30',
          '/set daily_review_tz Europe/Moscow',
          '/set daily_review_min_messages 1',
          '/set daily_review_model qwen/qwen-2.5-72b-instruct',
          '/set stt_enabled false',
          '/set stt_language ru',
        ].join('\n')
      );
      return;
    }
    try {
      const updated = await settings.setAlias(key, value, actorFromMsg(msg));
      if (key.startsWith('daily_review') && dailyReviewController) {
        dailyReviewController.restart();
      }
      await bot.sendMessage(
        msg.chat.id,
        `Updated ${key}: ${updated === '' ? '(empty)' : String(updated)}`
      );
    } catch (err) {
      await bot.sendMessage(msg.chat.id, 'set error: ' + err.message);
    }
  });

  bot.on('callback_query', async (query) => {
    const userId = query.from && query.from.id;
    const msg = query.message;
    if (!msg || !query.data || !query.data.startsWith('settings:')) return;
    if (!isAllowed(userId)) {
      await bot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
      return;
    }

    const action = query.data.slice('settings:'.length);
    try {
      if (action === 'toggle_mode') {
        const current = await modes.getMode(msg.chat.id);
        const next = current === 'silent' ? 'chat' : 'silent';
        await modes.setMode(msg.chat.id, next, actorFromCallback(query));
        await bot.answerCallbackQuery(query.id, {
          text: next === 'silent' ? 'Режим: тихий' : 'Режим: диалог',
        });
      } else if (action === 'toggle_stt') {
        const current = await settings.get('stt.enabled');
        await settings.set('stt.enabled', !current, actorFromCallback(query));
        await bot.answerCallbackQuery(query.id, {
          text: `Голосовые: ${!current ? 'вкл' : 'выкл'}`,
        });
      } else if (action === 'toggle_daily') {
        const current = await settings.get('dailyReview.enabled');
        await settings.set('dailyReview.enabled', !current, actorFromCallback(query));
        if (dailyReviewController) dailyReviewController.restart();
        await bot.answerCallbackQuery(query.id, {
          text: `Вечерняя сводка: ${!current ? 'вкл' : 'выкл'}`,
        });
      } else if (action === 'summary_now') {
        await bot.answerCallbackQuery(query.id, { text: 'Генерирую сводку...' });
        await bot.sendChatAction(msg.chat.id, 'typing');
        const result = await runReview(msg.chat.id, { force: true });
        if (result.skipped) {
          await bot.sendMessage(msg.chat.id, `Nothing to summarize yet (${result.reason}).`);
        } else {
          await bot.sendMessage(
            msg.chat.id,
            `🌙 Вечерняя сводка — ${result.today} (${result.entries} сообщений, ${result.model})`
          );
          await bot.sendDocument(msg.chat.id, result.file);
          await notifyInboxTriageResult(bot, msg.chat.id, result);
        }
      } else if (action === 'status') {
        await bot.answerCallbackQuery(query.id);
        const status = await runtime.buildStatus(msg.chat.id);
        await bot.sendMessage(msg.chat.id, '```\n' + runtime.formatStatus(status) + '\n```', {
          parse_mode: 'Markdown',
        });
      } else if (action === 'more') {
        await bot.answerCallbackQuery(query.id);
        await editSettingsMenu(bot, msg, 'more');
      } else if (action === 'main') {
        await bot.answerCallbackQuery(query.id);
        await editSettingsMenu(bot, msg, 'main');
      } else if (action === 'hint_time') {
        await bot.answerCallbackQuery(query.id, { text: 'Напиши /set daily_review_time 22:30' });
        await bot.sendMessage(
          msg.chat.id,
          'Чтобы поменять время вечерней сводки, напиши: /set daily_review_time 22:30'
        );
      } else {
        await bot.answerCallbackQuery(query.id, { text: 'Unknown action' });
      }

      if (
        !['summary_now', 'status', 'hint_time', 'more', 'main'].includes(action)
      ) {
        await editSettingsMenu(bot, msg, action === 'toggle_stt' ? 'more' : 'main');
      }
    } catch (err) {
      console.warn('[settings] callback error:', err.message);
      await bot.answerCallbackQuery(query.id, { text: err.message.slice(0, 200) });
    }
  });

  bot.onText(/^\/silent$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    await modes.setMode(msg.chat.id, 'silent', actorFromMsg(msg));
    await bot.sendMessage(
      msg.chat.id,
      'Silent mode on. Пиши спокойно — ничего не отвечаю, всё уйдёт в журнал. До вечернего ревью или /chat.'
    );
  });

  bot.onText(/^\/chat$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    await modes.setMode(msg.chat.id, 'chat', actorFromMsg(msg));
    await bot.sendMessage(msg.chat.id, 'Chat mode on.');
  });

  bot.onText(/^\/summary$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      await bot.sendChatAction(msg.chat.id, 'typing');
      const result = await runReview(msg.chat.id, { force: true });
      if (result.skipped) {
        await bot.sendMessage(
          msg.chat.id,
          `Nothing to summarize yet (${result.reason}).`
        );
        return;
      }
      await bot.sendMessage(
        msg.chat.id,
        `🌙 Вечерняя сводка — ${result.today} (${result.entries} сообщений, ${result.model})`
      );
      await bot.sendDocument(msg.chat.id, result.file);
      await notifyInboxTriageResult(bot, msg.chat.id, result);
    } catch (err) {
      console.error('[daily-review] /summary error:', err);
      await bot.sendMessage(
        msg.chat.id,
        'summary error: ' + (err && err.message ? err.message : String(err))
      );
    }
  });

  bot.onText(/^\/diag$/, async (msg) => {
    if (!isAllowed(msg.from && msg.from.id)) return replyUnauthorized(bot, msg);
    try {
      const { status, data } = await checkKey();
      await bot.sendMessage(
        msg.chat.id,
        `OpenRouter /auth/key → HTTP ${status}\n` +
          '```\n' +
          JSON.stringify(data, null, 2).slice(0, 3500) +
          '\n```',
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      await bot.sendMessage(msg.chat.id, 'diag error: ' + err.message);
    }
  });

  async function captureSilently(chatId, userMessage, { via = 'text', messageId } = {}) {
    await journal
      .append(chatId, { source: 'user', text: userMessage, via })
      .catch((e) => console.warn('[journal] append user failed:', e.message));
    if (messageId) {
      const reaction = (await settings.get('silent.reaction')) || SILENT_REACTION;
      await setReaction(chatId, messageId, reaction);
    }
  }

  async function handleUserMessage(chatId, userMessage, { via = 'text' } = {}) {
    await journal
      .append(chatId, { source: 'user', text: userMessage, via })
      .catch((e) => console.warn('[journal] append user failed:', e.message));

    await bot.sendChatAction(chatId, 'typing');
    const { reply, toolCalls } = await runAgent({ chatId, userMessage });

    if (toolCalls.length > 0) {
      console.log(
        `[agent] ${toolCalls.length} tool call(s): ` +
          toolCalls.map((t) => t.tool).join(', ')
      );
    }

    const text = reply && reply.trim() ? reply : '(empty reply)';
    await journal
      .append(chatId, { source: 'assistant', text, via: 'text' })
      .catch((e) => console.warn('[journal] append assistant failed:', e.message));
    await sendLong(bot, chatId, text);
  }

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const userId = msg.from && msg.from.id;
    if (!isAllowed(userId)) return replyUnauthorized(bot, msg);

    try {
      const mode = await modes.getMode(msg.chat.id);
      if (mode === 'silent') {
        await captureSilently(msg.chat.id, msg.text, {
          via: 'text',
          messageId: msg.message_id,
        });
        return;
      }
      const coalesceMs = config.telegram.textCoalesceMs;
      scheduleCoalescedTextMessage(msg.chat.id, msg.text, {
        coalesceMs,
        onFlush: (combined) =>
          handleUserMessage(msg.chat.id, combined).catch((err) => {
            console.error('[agent] error:', err);
            return bot
              .sendMessage(
                msg.chat.id,
                'Error: ' + (err && err.message ? err.message : String(err))
              )
              .catch((e) => console.warn('[telegram] error reply failed:', e.message));
          }),
      });
    } catch (err) {
      console.error('[agent] error:', err);
      await bot.sendMessage(
        msg.chat.id,
        'Error: ' + (err && err.message ? err.message : String(err))
      );
    }
  });

  async function downloadToTmp(fileId, extHint = 'oga') {
    const tmpDir = path.resolve(config.paths.tmpDir);
    await fse.ensureDir(tmpDir);
    const safeId = String(fileId).replace(/[^A-Za-z0-9_-]/g, '_');
    const tmpPath = path.join(tmpDir, `${Date.now()}_${safeId}.${extHint}`);
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmpPath);
      const rs = bot.getFileStream(fileId);
      rs.on('error', reject);
      ws.on('error', reject);
      ws.on('finish', resolve);
      rs.pipe(ws);
    });
    return tmpPath;
  }

  async function handleAudioMessage(msg, { fileId, duration, kind, extHint }) {
    const userId = msg.from && msg.from.id;
    if (!isAllowed(userId)) return replyUnauthorized(bot, msg);

    const chatId = msg.chat.id;

    if (!(await stt.isEnabled())) {
      await bot.sendMessage(
        chatId,
        `🎙 Received ${kind}, but STT is off: ${await stt.whyDisabled()}`
      );
      return;
    }

    const maxDurationSec = await settings.get('stt.maxDurationSec');
    if (duration && duration > maxDurationSec) {
      await bot.sendMessage(
        chatId,
        `🎙 ${kind} is ${duration}s — longer than stt.maxDurationSec=${maxDurationSec}. Ignored.`
      );
      return;
    }

    let tmpPath = null;
    try {
      await bot.sendChatAction(chatId, 'typing');
      tmpPath = await downloadToTmp(fileId, extHint);

      const t0 = Date.now();
      const transcription = await stt.transcribeFile(tmpPath);
      const ms = Date.now() - t0;

      const trimmed = (transcription || '').trim();
      if (!trimmed) {
        await bot.sendMessage(chatId, '🎙 (empty transcription)');
        return;
      }

      console.log(
        `[stt] ${kind} transcribed in ${ms}ms (${trimmed.length} chars)`
      );

      const mode = await modes.getMode(chatId);
      if (mode === 'silent') {
        await captureSilently(chatId, trimmed, {
          via: kind,
          messageId: msg.message_id,
        });
        return;
      }

      await bot.sendMessage(chatId, `🎙 ${trimmed}`);
      await handleUserMessage(chatId, trimmed, { via: kind });
    } catch (err) {
      console.error('[stt] error:', err);
      await bot.sendMessage(
        chatId,
        'STT error: ' + (err && err.message ? err.message : String(err))
      );
    } finally {
      if (tmpPath) {
        fse.remove(tmpPath).catch(() => {});
      }
    }
  }

  bot.on('voice', (msg) => {
    if (!msg.voice) return;
    handleAudioMessage(msg, {
      fileId: msg.voice.file_id,
      duration: msg.voice.duration,
      kind: 'voice',
      extHint: 'ogg',
    });
  });

  bot.on('audio', (msg) => {
    if (!msg.audio) return;
    const name = msg.audio.file_name || '';
    const ext = name.includes('.') ? name.split('.').pop() : 'mp3';
    handleAudioMessage(msg, {
      fileId: msg.audio.file_id,
      duration: msg.audio.duration,
      kind: 'audio',
      extHint: ext,
    });
  });

  bot.on('video_note', (msg) => {
    if (!msg.video_note) return;
    handleAudioMessage(msg, {
      fileId: msg.video_note.file_id,
      duration: msg.video_note.duration,
      kind: 'video_note',
      extHint: 'mp4',
    });
  });

  const ownerChatId = config.telegram.allowedUserIds[0];
  if (ownerChatId) {
    startBatteryWatcher({
      onLowBattery: async ({ percentage, status }) => {
        try {
          await bot.sendMessage(
            ownerChatId,
            `🔋 Battery low: ${percentage}% (${status}). Put me on a charger, please.`
          );
        } catch (err) {
          console.warn('[watcher:battery] failed to send alert:', err.message);
        }
      },
    });
  } else {
    console.warn(
      '[watcher:battery] no owner chat id (ALLOWED_TELEGRAM_USER_IDS empty), alerts disabled'
    );
  }

  reminders.startScheduler({
    onFire: async (r) => {
      try {
        await bot.sendMessage(r.chatId, `⏰ Reminder: ${r.text}`);
      } catch (err) {
        console.warn(`[reminders] failed to deliver ${r.id}:`, err.message);
      }
    },
  });

  dailyReviewController = runtime.createDailyReviewController({
    chatIds: config.telegram.allowedUserIds,
    onReview: async (chatId, result) => {
      try {
        const wasSilent = (await modes.getMode(chatId)) === 'silent';
        const autoExit = await settings.get('silent.autoExitOnDailyReview');
        if (wasSilent && autoExit) {
          await modes.setMode(chatId, 'chat', { type: 'daily-review' });
        }
        await bot.sendMessage(
          chatId,
          `🌙 Вечерняя сводка — ${result.today} (${result.entries} сообщений, ${result.model})`
        );
        await bot.sendDocument(chatId, result.file);
        await notifyInboxTriageResult(bot, chatId, result);
        if (wasSilent && autoExit) {
          await bot.sendMessage(
            chatId,
            'Silent mode off. Давай обсудим — что зацепило или с чем поспорить?'
          );
        }
      } catch (err) {
        console.warn(
          `[daily-review] failed to deliver to ${chatId}:`,
          err.message
        );
      }
    },
  });
  dailyReviewController.start();

  console.log(
    `[bot] Vatoko Galaxy started. Model=${config.openrouter.model} AllowShell=${config.safety.allowShell}`
  );
  return bot;
}

function actorFromMsg(msg) {
  return {
    type: 'telegram',
    userId: msg.from && msg.from.id,
    username: msg.from && msg.from.username,
    chatId: msg.chat && msg.chat.id,
  };
}

function actorFromCallback(query) {
  return {
    type: 'telegram_callback',
    userId: query.from && query.from.id,
    username: query.from && query.from.username,
    chatId: query.message && query.message.chat && query.message.chat.id,
  };
}

async function settingsKeyboard(chatId, page = 'main') {
  const s = await runtime.buildStatus(chatId);
  if (page === 'more') {
    return {
      inline_keyboard: [
        [
          {
            text: `Голос в текст: ${s.stt.configured ? 'вкл' : 'выкл'}`,
            callback_data: 'settings:toggle_stt',
          },
        ],
        [
          { text: 'Полный статус', callback_data: 'settings:status' },
          { text: 'Изменить время сводки', callback_data: 'settings:hint_time' },
        ],
        [{ text: 'Назад', callback_data: 'settings:main' }],
      ],
    };
  }

  return {
    inline_keyboard: [
      [
        {
          text:
            s.mode === 'silent'
              ? 'Режим: тихий'
              : 'Режим: диалог',
          callback_data: 'settings:toggle_mode',
        },
      ],
      [
        {
          text: `Вечерняя сводка: ${s.dailyReview.enabled ? 'вкл' : 'выкл'}`,
          callback_data: 'settings:toggle_daily',
        },
      ],
      [
        { text: 'Сводка сейчас', callback_data: 'settings:summary_now' },
        { text: 'Дополнительно', callback_data: 'settings:more' },
      ],
    ],
  };
}

async function settingsMenuText(chatId, page = 'main') {
  const s = await runtime.buildStatus(chatId);
  const next = s.dailyReview.next ? s.dailyReview.next.local : 'выключена';
  const mode = s.mode === 'silent' ? 'тихий (только записываю)' : 'диалог';
  if (page === 'more') {
    return [
      'Дополнительные настройки',
      '',
      `Голос в текст: ${s.stt.configured ? 'включён' : 'выключен'} (язык: ${s.stt.language})`,
      `Макс. длина голосового: ${s.stt.maxDurationSec} сек.`,
      `Модель сводки: ${s.dailyReview.model}`,
      `Минимум записей для автосводки: ${s.dailyReview.minMessages}`,
      '',
      'Точные правки:',
      '/set daily_review_time 22:30',
      '/set daily_review_min_messages 1',
      '/set stt_enabled false',
    ].join('\n');
  }

  return [
    'Настройки агента',
    '',
    `Режим: ${mode}`,
    `Вечерняя сводка: ${s.dailyReview.enabled ? 'включена' : 'выключена'}`,
    `Следующая сводка: ${next}`,
    '',
    'Редко используемые настройки — в "Дополнительно".',
  ].join('\n');
}

async function sendSettingsMenu(bot, chatId) {
  await bot.sendMessage(chatId, await settingsMenuText(chatId), {
    reply_markup: await settingsKeyboard(chatId),
  });
}

async function editSettingsMenu(bot, msg, page = 'main') {
  await bot.editMessageText(await settingsMenuText(msg.chat.id, page), {
    chat_id: msg.chat.id,
    message_id: msg.message_id,
    reply_markup: await settingsKeyboard(msg.chat.id, page),
  });
}

async function replyUnauthorized(bot, msg) {
  const id = msg.from && msg.from.id;
  console.warn(`[auth] rejected user ${id} (@${msg.from && msg.from.username})`);
  await bot.sendMessage(
    msg.chat.id,
    `Unauthorized. Your Telegram id is ${id}. Add it to ALLOWED_TELEGRAM_USER_IDS in .env.`
  );
}

async function sendLong(bot, chatId, text) {
  const CHUNK = 3500;
  if (text.length <= CHUNK) {
    await bot.sendMessage(chatId, text);
    return;
  }
  for (let i = 0; i < text.length; i += CHUNK) {
    await bot.sendMessage(chatId, text.slice(i, i + CHUNK));
  }
}

module.exports = { start };

if (require.main === module) {
  start();
}
