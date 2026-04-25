#!/data/data/com.termux/files/usr/bin/sh
set -eu

REPO_URL="${GALAXY_AGENT_REPO_URL:-https://github.com/Dinodark/Galaxy-S8-Agent.git}"
APP_DIR="${GALAXY_AGENT_DIR:-$HOME/Galaxy-S8-Agent}"
SESSION_NAME="${GALAXY_AGENT_SESSION:-galaxy-agent}"

info() { printf '\033[1;34m[agent-install]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[agent-install]\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31m[agent-install]\033[0m %s\n' "$*" >&2; exit 1; }

if [ -z "${PREFIX:-}" ] || [ ! -d "$PREFIX" ]; then
  fail "This installer is intended for Termux. Install Termux from F-Droid and run it there."
fi

info "Updating Termux packages..."
pkg update -y

info "Installing required packages..."
pkg install -y nodejs git termux-api tmux curl

if [ -d "$APP_DIR/.git" ]; then
  info "Existing checkout found at $APP_DIR; pulling updates..."
  git -C "$APP_DIR" pull --ff-only
else
  if [ -e "$APP_DIR" ]; then
    fail "$APP_DIR exists but is not a git checkout. Move it away or set GALAXY_AGENT_DIR."
  fi
  info "Cloning $REPO_URL to $APP_DIR..."
  git clone "$REPO_URL" "$APP_DIR"
fi

info "Installing npm dependencies..."
(cd "$APP_DIR" && npm install)

info "Creating command shortcuts in $PREFIX/bin..."
cat > "$PREFIX/bin/agent-start" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
cd "$APP_DIR"
GALAXY_AGENT_SESSION="$SESSION_NAME" sh scripts/start.sh "\$@"
EOF
cat > "$PREFIX/bin/agent-stop" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
cd "$APP_DIR"
GALAXY_AGENT_SESSION="$SESSION_NAME" sh scripts/stop.sh "\$@"
EOF
cat > "$PREFIX/bin/agent-logs" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
cd "$APP_DIR"
GALAXY_AGENT_SESSION="$SESSION_NAME" sh scripts/logs.sh "\$@"
EOF
cat > "$PREFIX/bin/agent-update" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
cd "$APP_DIR"
GALAXY_AGENT_SESSION="$SESSION_NAME" sh scripts/update.sh "\$@"
EOF
cat > "$PREFIX/bin/agent-doctor" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
cd "$APP_DIR"
npm run doctor
EOF
chmod +x "$PREFIX/bin/agent-start" "$PREFIX/bin/agent-stop" "$PREFIX/bin/agent-logs" "$PREFIX/bin/agent-update" "$PREFIX/bin/agent-doctor"

if [ ! -f "$APP_DIR/.env" ]; then
  info "Running first-time setup..."
  (cd "$APP_DIR" && npm run setup)
else
  warn ".env already exists; skipping setup. Run 'npm run setup' inside $APP_DIR to reconfigure."
fi

info "Running doctor..."
(cd "$APP_DIR" && npm run doctor || true)

info "Done."
info "Start the bot with: agent-start"
info "Watch logs with:  agent-logs"
info "Update later with: agent-update"
