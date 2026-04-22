# Galaxy S8 Agent

Personal AI agent that lives on a Samsung Galaxy S8 phone (via Termux),
talks to you through Telegram, reasons with an LLM (OpenRouter), and can
actually control the device through a set of tools.

## Architecture

```
index.js
└─ bot/telegram.js        thin Telegram adapter + whitelist auth
   ├─ core/agent.js       tool-calling loop (LLM ↔ tools)
   │  ├─ core/llm.js      OpenRouter client
   │  ├─ core/memory.js   per-chat history + long-term markdown notes
   │  └─ core/tools/
   │     ├─ phone.js      termux-api: battery, toast, notify, clipboard,
   │     │                vibrate, location, sms_send, contacts
   │     ├─ shell.js      run_shell (disabled by default, ALLOW_SHELL=true)
   │     ├─ files.js      read_file / write_file / list_dir
   │     └─ memory.js     list_notes / read_note / write_note
   └─ core/watchers/      proactive background tasks
      └─ battery.js       low-battery DM alert
```

Runtime data lives under `memory/` (chat histories + long-term notes) and
`logs/`. Both are gitignored.

## Setup (dev machine)

```bash
git clone https://github.com/Dinodark/Galaxy-S8-Agent.git
cd Galaxy-S8-Agent
npm install
cp .env.example .env
# edit .env: put your OpenRouter key, Telegram token, and your Telegram user id
node index.js
```

Get your Telegram user id by writing to [@userinfobot](https://t.me/userinfobot).
Get an OpenRouter key at <https://openrouter.ai/keys>.
Get a bot token from [@BotFather](https://t.me/BotFather).

## Setup (Galaxy S8 via Termux)

Install Termux from **F-Droid** (not Google Play — that version is outdated):
<https://f-droid.org/packages/com.termux/>

Also install **Termux:API** (the companion app) from F-Droid:
<https://f-droid.org/packages/com.termux.api/>

Then inside Termux:

```sh
pkg update && pkg upgrade -y
pkg install -y nodejs git termux-api
termux-setup-storage

git clone https://github.com/Dinodark/Galaxy-S8-Agent.git
cd Galaxy-S8-Agent
npm install
cp .env.example .env
nano .env   # put your real keys and user id

node index.js
```

### Keeping it running

To keep the agent alive when the screen is off, acquire a wakelock and
either run it in a `tmux` session or use `nohup`:

```sh
termux-wake-lock
pkg install -y tmux
tmux new -s agent
node index.js
# detach: Ctrl-b then d
```

## Commands in Telegram

- `/start` — status + your Telegram id
- `/ping` — liveness check
- `/diag` — check OpenRouter key status (credits, limits)
- `/battery` — current phone battery (Termux only)
- `/reset` — wipe the current chat's history

## Background watchers

The bot runs periodic watchers alongside the chat loop. Each watcher is
self-disabling when its prerequisites are missing (e.g. no `termux-api`).

- **Battery low alert**: polls `termux-battery-status` every
  `BATTERY_POLL_INTERVAL_MS` (5 min by default). When level drops at or
  below `BATTERY_LOW_THRESHOLD` (20%) AND the phone is not charging, it
  DMs the owner once. Re-arms after the battery recovers above
  `threshold + BATTERY_HYSTERESIS`.

Anything else goes through the agent.

## Troubleshooting

### OpenRouter 403 "violation of provider Terms Of Service"
The upstream provider (OpenAI / Google) refused the request based on
your IP region. Both `openai/*` and `google/gemini-*` geo-block RU/BY
and several other regions. Switch `OPENROUTER_MODEL` in `.env` to a
geo-safe provider:
- `deepseek/deepseek-chat` — very cheap, hosted in CN, works everywhere
- `mistralai/mistral-small-3.1-24b-instruct` — EU-hosted
- `qwen/qwen-2.5-72b-instruct` — Alibaba
- `anthropic/claude-haiku-4.5` — best quality/price when available
Then restart the bot. Full list: <https://openrouter.ai/models>

### 401 / 402 from OpenRouter
- 401 — bad or revoked key; regenerate at <https://openrouter.ai/keys>.
- 402 — insufficient credits; top up at <https://openrouter.ai/credits>.

### `/diag` command
In Telegram send `/diag` to ping `/auth/key` and see your account status
(credits, rate limits, allowed models).

## Safety notes

- **Whitelist**: only user ids listed in `ALLOWED_TELEGRAM_USER_IDS` can
  talk to the bot. If empty, everyone is rejected.
- **Shell tool**: disabled by default. Set `ALLOW_SHELL=true` in `.env`
  to let the agent run shell commands.
- **SMS**: `phone_sms_send` requires SMS permission to be granted to
  Termux:API in Android settings. Use with care.
- **Location / contacts**: require permissions granted to Termux:API.
- **Secrets**: `.env` is gitignored. Never commit real keys.
- If any secret is ever exposed (including in chat logs), rotate it
  immediately.

## Adding a new tool

1. Add a file (or entry) under `core/tools/`.
2. Export an object: `{ name, description, parameters, handler }`.
   `parameters` is a JSON Schema describing the arguments.
3. Register it by requiring it in `core/tools/index.js`.
4. Done — the LLM will discover it on next turn.
