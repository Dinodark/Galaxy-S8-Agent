#!/data/data/com.termux/files/usr/bin/sh
set -eu

SESSION_NAME="${GALAXY_AGENT_SESSION:-galaxy-agent}"
WAS_RUNNING=0

if tmux has-session -t "$SESSION_NAME" 2>/dev/null; then
  WAS_RUNNING=1
  echo "Stopping running agent before update..."
  sh scripts/stop.sh
fi

echo "Pulling latest code..."
git pull --ff-only

echo "Installing npm dependencies..."
npm install

echo "Running doctor..."
npm run doctor || true

if [ "$WAS_RUNNING" = "1" ]; then
  echo "Restarting agent..."
  sh scripts/start.sh
else
  echo "Update complete. Start with: agent-start"
fi
