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
   │  ├─ core/stt.js      Groq Whisper client (voice message transcription)
   │  ├─ core/memory.js   per-chat history + long-term markdown notes
   │  └─ core/tools/
   │     ├─ phone.js      termux-api: battery, toast, notify, clipboard,
   │     │                vibrate, location, sms_send, contacts
   │     ├─ shell.js      run_shell (disabled by default, ALLOW_SHELL=true)
   │     ├─ files.js      read_file / write_file / list_dir
   │     └─ memory.js     list_notes / read_note / write_note
   ├─ core/reminders.js   persistent time-based reminders + scheduler
   ├─ core/journal.js     raw per-chat per-day conversation log (jsonl)
   ├─ core/settings.js    Settings Center (memory/settings.json + audit)
   ├─ core/runtime.js     shared status + watcher controllers
   ├─ core/web_server.js  local token-protected read-only web UI
   ├─ core/modes.js       per-chat mode (chat | silent) persisted
   └─ core/watchers/      proactive background tasks
      ├─ battery.js       low-battery DM alert
      └─ daily_review.js  end-of-day reflective summary (cron-scheduled)
```

Runtime data lives under `memory/` (chat histories, long-term notes,
settings, audit logs) and `logs/`. Both are gitignored.

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
Get a free Groq key for voice message transcription at
<https://console.groq.com/keys> (optional — leave `GROQ_API_KEY` empty
to disable voice support).

## One-command Termux install

For first-time testers, install **Termux** and **Termux:API** from F-Droid,
then paste one command into Termux:

```sh
curl -fsSL https://raw.githubusercontent.com/Dinodark/Galaxy-S8-Agent/main/install.sh | sh
```

The installer will install packages, clone/update the repo, run `npm install`,
ask for keys, create `.env`, write `memory/settings.json`, and create helper
commands:

- `agent-start` — start the bot in tmux
- `agent-stop` — stop the bot
- `agent-logs` — attach to logs
- `agent-update` — pull updates and reinstall dependencies
- `agent-doctor` — run environment checks
- `agent-web` — start the local web UI in tmux

Prepare these values before running setup:

- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Your Telegram user id from [@userinfobot](https://t.me/userinfobot)
- OpenRouter API key from <https://openrouter.ai/keys>
- Optional Groq API key from <https://console.groq.com/keys> for voice messages

## Manual setup (Galaxy S8 via Termux)

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

## Voice messages

If `GROQ_API_KEY` is set, the bot accepts:

- **Voice notes** (hold-to-record in Telegram) — OGG/Opus
- **Forwarded audio files** — MP3, M4A, WAV, OGG, etc.
- **Round video notes** — audio track is transcribed

Flow: Telegram → download to `memory/tmp/` → Groq Whisper
(`whisper-large-v3-turbo` by default) → bot echoes the transcription
back as `🎙 <text>` → feeds it into the agent as a normal user
message. In `/silent` mode, the transcription echo is skipped and only
a reaction is added to the original Telegram message. Temp files are
auto-deleted after transcription.

Tunables (prefer `/settings` or `/set`; `.env` is only first-boot
fallback):

- `GROQ_STT_MODEL` — default `whisper-large-v3-turbo`. Use
  `whisper-large-v3` for slightly better quality at ~3x the latency.
- `STT_LANGUAGE` — ISO-639-1 hint. `ru` is the default. Set empty to
  auto-detect.
- `STT_MAX_DURATION_SEC` — cap per message (default 300s) to avoid
  surprise bills. Messages longer than this are ignored with a note.
- `STT_ENABLED=false` — hard-disable voice handling even if the key
  is set.

Set `GROQ_API_KEY=` (empty) to disable entirely; the bot will politely
say STT is off when you send a voice note.

## Settings Center

Secrets and bootstrap values stay in `.env`:

- `TELEGRAM_BOT_TOKEN`
- `OPENROUTER_API_KEY`
- `GROQ_API_KEY`
- `ALLOWED_TELEGRAM_USER_IDS`
- `ALLOW_SHELL`

Behavior is controlled by the Settings Center and persisted to
`memory/settings.json`. Every change is appended to
`memory/settings_audit.jsonl`. This gives the Telegram UI and a future
web UI the same backend: both can call the same core settings/runtime
helpers.

Useful commands:

- `/settings` — inline buttons for common toggles (mode, STT, daily
  review, status, summary now).
- `/status` — full runtime status: mode, STT, next daily review,
  journal entries today, reminders, battery watcher.
- `/set daily_review_time 22:30` — set the daily review time.
- `/set daily_review_tz Europe/Moscow` — set timezone.
- `/set daily_review_min_messages 1` — change skip threshold.
- `/set daily_review_model qwen/qwen-2.5-72b-instruct` — use a model
  just for evening reviews.
- `/set stt_enabled false` and `/set stt_language ru` — STT behavior.
- `/web` — show the local web UI URL with its private token.

Changing daily-review settings through `/settings` or `/set` restarts
the scheduler in-process; no Termux restart is needed.

## Commands in Telegram

- `/start` — status + your Telegram id
- `/status` — full runtime status
- `/settings` — Settings Center buttons
- `/set ...` — change supported settings by name
- `/web` — show the local web UI URL for the phone's Wi-Fi IP
- `/atlas` — build and send an interactive HTML memory mindmap
- `/atlas_status` — show mindmap stats
- `/ping` — liveness check
- `/diag` — check OpenRouter key status (credits, limits)
- `/battery` — current phone battery (Termux only)
- `/reminders` — list pending reminders with ids
- `/summary` — generate today's evening review right now
- `/silent` — capture-only mode: no replies, just a ✍ reaction on each
  message, everything goes into the journal for the evening review.
  Auto-exits when the scheduled daily review fires.
- `/chat` — switch back to normal conversational mode.
- `/reset` — wipe the current chat's history

## Background watchers

The bot runs periodic watchers alongside the chat loop. Each watcher is
self-disabling when its prerequisites are missing (e.g. no `termux-api`).

- **Battery low alert**: polls `termux-battery-status` every
  `BATTERY_POLL_INTERVAL_MS` (5 min by default). When level drops at or
  below `BATTERY_LOW_THRESHOLD` (20%) AND the phone is not charging, it
  DMs the owner once. Re-arms after the battery recovers above
  `threshold + BATTERY_HYSTERESIS`.
- **Reminder scheduler**: polls `memory/reminders.json` every
  `REMINDERS_POLL_INTERVAL_MS` (30s by default). Any reminder whose
  `fire_at` is in the past is delivered as `⏰ Reminder: <text>` and
  either removed (one-shot) or rescheduled to its next occurrence
  (recurring). Reminders are persisted, so they survive restarts;
  anything that went overdue while the bot was offline fires ~1.5s
  after boot. Users create reminders through the agent — just ask in
  natural language:
  - *"напомни через час выключить чайник"* — one-shot
  - *"каждое утро в 7:30 напоминай зарядку"* — recurring (cron `30 7 * * *`)
  - *"по понедельникам в 9 присылай план на неделю"* — `0 9 * * 1`
  - *"каждые 15 минут напоминай встать"* — `*/15 * * * *`

  Recurring reminders use standard 5-field POSIX cron (`min hour dom mon dow`).
  Timezone defaults to the phone's system TZ (set `TZ=Europe/Moscow` in
  `~/.bashrc` if Termux reports UTC). Recurrence can be bounded with
  `until` (ISO date) or `max_count` (integer) passed to `reminder_add`
  via the agent.

- **Daily evening review**: cron-scheduled (default `30 22 * * *` — 22:30
  local time). At fire time, for each whitelisted user:
  1. Load today's journal (`memory/journal/<chatId>/YYYY-MM-DD.jsonl`) —
     every user and agent message timestamped, incl. transcribed voice.
  2. Load long-term notes from `memory/notes/` (diary, ideas, work, …).
  3. Load the last configured number of evening summaries for
     continuity.
  4. Ask the LLM (optionally a stronger model via Settings Center)
     for a reflective markdown summary: `Главное за день`, `Связи`,
     `Мои мысли`, `На завтра`.
  5. Save to `memory/notes/summary-YYYY-MM-DD.md` (so the agent sees it
     as long-term memory going forward) and DM it as a markdown file.

  Tweak the tone/structure by editing `core/prompts/daily_review.md`.
  Trigger an early summary any time with `/summary`. Days with fewer
  than the configured `dailyReview.minMessages` journal entries are
  skipped silently so empty days don't spam. Use `/set daily_review_time
  22:30` or `/settings` to change the schedule without restarting.

Anything else goes through the agent.

## Memory atlas

`/atlas` builds a standalone interactive HTML mindmap at `memory/atlas.html`
and sends it to Telegram as a file. It is generated locally from:

- `memory/notes/*.md`
- `memory/notes/summary-YYYY-MM-DD.md`
- the last few journal days for the current chat

The first MVP does not call an LLM, so it is fast and cheap. It extracts
headings, keywords, note files, daily summaries, and shared topics, then
renders a draggable graph with a side panel for details. The cached index
lives in `memory/memory_index.json`.

## Local web UI

The agent can also serve a read-only web dashboard from the phone for devices
on the same trusted Wi-Fi/VPN network:

```sh
agent-web
```

Then send `/web` in a private Telegram chat with the bot. It returns a URL like
`http://PHONE_IP:8787/?token=...`. The dashboard includes runtime status,
the memory atlas, markdown notes, daily summaries, journal days, and sanitized
settings. All endpoints require the token, and the MVP does not expose write
actions or secrets.

For local development you can run:

```sh
npm run web
```

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

### Voice messages do nothing / "STT is off"
The bot reports why in the reply:
- `GROQ_API_KEY is not set in .env` — add a key from
  <https://console.groq.com/keys>.
- `STT_ENABLED is false in .env` — set it to `true`.
After editing `.env`, restart the bot.

### "STT requires Node.js >= 18"
`core/stt.js` uses native `fetch`/`FormData`/`Blob`. Upgrade Node in
Termux: `pkg upgrade nodejs`. Verify with `node -v` (should be ≥ 18).

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
