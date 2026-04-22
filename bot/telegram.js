const TelegramBot = require('node-telegram-bot-api');
const config = require('../config');
const { runAgent } = require('../core/agent');
const { checkKey } = require('../core/llm');
const memory = require('../core/memory');
const { startBatteryWatcher } = require('../core/watchers/battery');
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
      }\n\nCommands:\n/ping — liveness check\n/diag — OpenRouter key status\n/battery — phone battery status\n/reset — wipe this chat's history`
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

  bot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/')) return;

    const userId = msg.from && msg.from.id;
    if (!isAllowed(userId)) return replyUnauthorized(bot, msg);

    const chatId = msg.chat.id;

    try {
      await bot.sendChatAction(chatId, 'typing');
      const { reply, toolCalls } = await runAgent({
        chatId,
        userMessage: msg.text,
      });

      if (toolCalls.length > 0) {
        console.log(
          `[agent] ${toolCalls.length} tool call(s): ` +
            toolCalls.map((t) => t.tool).join(', ')
        );
      }

      const text = reply && reply.trim() ? reply : '(empty reply)';
      await sendLong(bot, chatId, text);
    } catch (err) {
      console.error('[agent] error:', err);
      await bot.sendMessage(
        chatId,
        'Error: ' + (err && err.message ? err.message : String(err))
      );
    }
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
