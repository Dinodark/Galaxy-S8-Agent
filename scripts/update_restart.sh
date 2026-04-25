#!/data/data/com.termux/files/usr/bin/sh
set -u

APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
cd "$APP_DIR" || exit 1

LOG_FILE="${GALAXY_AGENT_UPDATE_LOG:-memory/tmp/update-restart.log}"
PID_FILE="${GALAXY_AGENT_UPDATE_PID:-memory/tmp/update-restart.pid}"
BOT_SESSION="${GALAXY_AGENT_SESSION:-galaxy-agent}"
WEB_SESSION="${GALAXY_AGENT_WEB_SESSION:-galaxy-agent-web}"

mkdir -p memory/tmp
: > "$LOG_FILE"
echo "$$" > "$PID_FILE"

cleanup() {
  rm -f "$PID_FILE"
}
trap cleanup EXIT INT TERM

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

run() {
  log "$ $*"
  "$@" >> "$LOG_FILE" 2>&1
}

stop_session() {
  session="$1"
  label="$2"
  if tmux has-session -t "$session" 2>/dev/null; then
    log "Stopping $label session: $session"
    tmux send-keys -t "$session" C-c
    sleep 1
    tmux kill-session -t "$session" 2>/dev/null || true
  else
    log "$label session is not running: $session"
  fi
}

start_session() {
  session="$1"
  label="$2"
  command="$3"
  if tmux has-session -t "$session" 2>/dev/null; then
    log "$label session already running: $session"
    return
  fi
  log "Starting $label session: $session"
  tmux new-session -d -s "$session" "$command"
}

log "Galaxy S8 Agent update/restart started."
log "App dir: $APP_DIR"

log "Pulling latest code..."
run git pull --ff-only

log "Installing npm dependencies..."
run npm install

log "Running doctor..."
npm run doctor >> "$LOG_FILE" 2>&1 || log "Doctor finished with warnings."

stop_session "$BOT_SESSION" "bot"
stop_session "$WEB_SESSION" "web"

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >> "$LOG_FILE" 2>&1 || true
fi

start_session "$BOT_SESSION" "bot" "npm start"
start_session "$WEB_SESSION" "web" "npm run web"

log "Update/restart complete."
