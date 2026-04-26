#!/data/data/com.termux/files/usr/bin/sh
set -eu

SESSION_NAME="${GALAXY_AGENT_WEB_SESSION:-galaxy-agent-web}"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "Vatoko Galaxy web UI is already running in tmux session: $SESSION_NAME"
  echo "Open Telegram and send /web to get the URL."
  exit 0
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

tmux new-session -d -s "$SESSION_NAME" "npm run web"
echo "Vatoko Galaxy web UI started in tmux session: $SESSION_NAME"
echo "Open Telegram and send /web to get the URL."
