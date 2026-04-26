#!/data/data/com.termux/files/usr/bin/sh
set -eu

BOT_SESSION="${GALAXY_AGENT_SESSION:-galaxy-agent}"
WEB_SESSION="${GALAXY_AGENT_WEB_SESSION:-galaxy-agent-web}"

echo "Starting Vatoko Galaxy bot and web UI..."
GALAXY_AGENT_SESSION="$BOT_SESSION" sh scripts/start.sh
GALAXY_AGENT_WEB_SESSION="$WEB_SESSION" sh scripts/web.sh

echo ""
echo "Done. In Telegram, send /web to get the dashboard URL."
