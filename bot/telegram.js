const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const { runAgent } = require('../core/agent');
const { checkKey } = require('../core/llm');
const stt = require('../core/stt');
const memory = require('../core/memory');
const reminders = require('../core/reminders');
const journal = require('../core/journal');
const { startBatteryWatcher } = require('../core/watchers/battery');
const {
  startDailyReviewer,
  runReview,
} = require('../core/watchers/daily_review');
const { isAllowed } = require('./auth');

function start() {
  const bot = new TelegramBot(config.telegram.token, { polling: true });

  bot.on('polling_error', (err) => {
    console.error('[telegram] polling_error:', err.message);
  });

  bot.onText(/^\/start$/, async (msg) => {
    const id = msg.from && msg.from.id;
    if (!isAllowed(id)) return replyUnauthorized(bot, msg);
    await bot.sendMessage(
      msg.chat.id,
      `Galaxy S8 Agent online.\nYour id: ${id}\nModel: ${config.openrouter.model}\nShell: ${
        config.safety.allowShell ? 'enabled' : 'disabled'
      }\nBattery watch: ${
        config.battery.enabled
          ? `on (<${config.battery.lowThreshold}%)`
          : 'off'
      }\nSTT: ${
        stt.isEnabled() ? `on (${config.groq.sttModel})` : `off (${stt.whyDisabled()})`
      }\nReminders: on (poll ${Math.round(config.reminders.pollIntervalMs / 1000)}s)\nDaily review: ${
        config.dailyReview.enabled
          ? `on (cron "${config.dailyReview.cron}", tz=${
              config.dailyReview.tz || journal.systemTz()
            })`
          : 'off'
      }\n\nCommands:\n/ping — liveness check\n/diag — OpenRouter key status\n/battery — phone battery status\n/reminders — list pending reminders\n/summary — generate today's evening review now\n/reset — wipe this chat's history`
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
      await handleUserMessage(msg.chat.id, msg.text);
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

    if (!stt.isEnabled()) {
      await bot.sendMessage(
        chatId,
        `🎙 Received ${kind}, but STT is off: ${stt.whyDisabled()}`
      );
      return;
    }

    if (duration && duration > config.stt.maxDurationSec) {
      await bot.sendMessage(
        chatId,
        `🎙 ${kind} is ${duration}s — longer than STT_MAX_DURATION_SEC=${config.stt.maxDurationSec}. Ignored.`
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

  startDailyReviewer({
    chatIds: config.telegram.allowedUserIds,
    onReview: async (chatId, result) => {
      try {
        await bot.sendMessage(
          chatId,
          `🌙 Вечерняя сводка — ${result.today} (${result.entries} сообщений, ${result.model})`
        );
        await bot.sendDocument(chatId, result.file);
      } catch (err) {
        console.warn(
          `[daily-review] failed to deliver to ${chatId}:`,
          err.message
        );
      }
    },
  });

  console.log(
    `[bot] Galaxy S8 Agent started. Model=${config.openrouter.model} AllowShell=${config.safety.allowShell}`
  );
  return bot;
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
