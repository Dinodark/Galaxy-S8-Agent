#!/data/data/com.termux/files/usr/bin/sh
set -eu

SESSION_NAME="${GALAXY_AGENT_SESSION:-galaxy-agent}"

if ! tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  echo "Galaxy S8 Agent is not running."
  echo "Use: agent-start"
  exit 1
fi

echo "Attaching to $SESSION_NAME. Detach with: Ctrl-b then d"
tmux attach -t "$SESSION_NAME"
