#!/data/data/com.termux/files/usr/bin/sh
set -eu

BOT_SESSION="${GALAXY_AGENT_SESSION:-galaxy-agent}"
WEB_SESSION="${GALAXY_AGENT_WEB_SESSION:-galaxy-agent-web}"

echo "Stopping Vatoko Galaxy bot and web UI..."
GALAXY_AGENT_SESSION="$BOT_SESSION" sh scripts/stop.sh
GALAXY_AGENT_SESSION="$WEB_SESSION" sh scripts/stop.sh

echo "Done."
