# Vatoko Galaxy Tester Guide

This guide is for first testers installing the agent on an Android phone
through Termux.

## 1. Install apps

Install from F-Droid:

- Termux: https://f-droid.org/packages/com.termux/
- Termux:API: https://f-droid.org/packages/com.termux.api/

Do not use the old Google Play Termux build.

## 2. Prepare accounts and keys

You need:

- Telegram bot token from @BotFather
- Your Telegram user id from @userinfobot
- OpenRouter API key: https://openrouter.ai/keys
- Optional Groq API key for voice-to-text: https://console.groq.com/keys

## 3. Install with one command

Open Termux and paste:

```sh
curl -fsSL https://raw.githubusercontent.com/Dinodark/Galaxy-S8-Agent/main/install.sh | sh
```

Answer the setup questions. Secrets are saved to `.env`; behavior settings
are saved to `memory/settings.json`. At the end, the installer starts both the
Telegram bot and the local web panel.

## 4. Start and update

```sh
agent-up
agent-logs
agent-down
agent-update
agent-doctor
```

`agent-up` starts both the Telegram bot and the local web panel. `agent-down`
stops both. `agent-start` and `agent-web` are still available if you want to
start only one process.

Detach from logs with `Ctrl-b`, then `d`.

## 5. Try in Telegram

Send:

```text
/start
/settings
/status
/web
напомни через 2 минуты проверить чай
```

Try a voice message if Groq is configured.

Useful commands:

- `/silent` — capture-only mode; no replies, only a reaction
- `/chat` — normal mode
- `/summary` — generate today's evening summary now
- `/atlas` — build and send the memory mindmap
- `/web` — get the local web UI URL
- `/reminders` — list pending reminders

## 6. Open the local web UI

If you used `agent-up`, the dashboard server is already running. If you only
started the bot, start the dashboard on the phone:

```sh
agent-web
```

Then send `/web` to the bot in a private Telegram chat and open the returned
URL from a browser on the same Wi-Fi/VPN network. The URL contains a private
token; do not post it in group chats. The web UI shows status, memory atlas,
notes, summaries, journal days, and sanitized settings.

The `Update` panel has an **Update & restart** button. It pulls the latest
code, installs npm dependencies, runs doctor, and restarts both bot and web
tmux sessions. It uses the committed dashboard build, so the phone does not
need to run `npm run web:build`. It can briefly disconnect the page because
the web server restarts itself. Use it only from a trusted Wi-Fi/VPN network.

## Troubleshooting

### Bot does not answer

Check logs:

```sh
agent-logs
```

If you see Telegram `ETIMEDOUT`, enable VPN and restart:

```sh
agent-stop
agent-start
```

### `git pull` refuses because `package-lock.json` changed

```sh
git checkout -- package-lock.json
agent-update
```

### Phone tools do not work

Install Termux:API app from F-Droid and run:

```sh
pkg install termux-api
agent-doctor
```

Grant Android permissions when prompted.

### Bot stops in background

Run:

```sh
termux-wake-lock
```

Also disable battery optimization for Termux in Android settings if needed.

### Voice messages do not work

Run `/status`. If voice-to-text is off, add a Groq key and enable it from
`/settings` -> `Дополнительно`.
