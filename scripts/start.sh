#!/data/data/com.termux/files/usr/bin/sh
set -eu

SESSION_NAME="${GALAXY_AGENT_SESSION:-galaxy-agent}"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "Galaxy S8 Agent is already running in tmux session: $SESSION_NAME"
  echo "Use: agent-logs"
  exit 0
fi

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock || true
fi

tmux new-session -d -s "$SESSION_NAME" "npm start"
echo "Galaxy S8 Agent started in tmux session: $SESSION_NAME"
echo "Use: agent-logs"
