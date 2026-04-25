#!/data/data/com.termux/files/usr/bin/sh
set -eu

SESSION_NAME="${GALAXY_AGENT_SESSION:-galaxy-agent}"

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  tmux send-keys -t "$SESSION_NAME" C-c
  sleep 1
  tmux kill-session -t "$SESSION_NAME" 2>/dev/null || true
  echo "Galaxy S8 Agent stopped."
else
  echo "Galaxy S8 Agent is not running."
fi

if command -v termux-wake-unlock >/dev/null 2>&1; then
  termux-wake-unlock || true
fi
