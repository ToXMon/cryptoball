#!/usr/bin/env bash
# Rolling schedule for devnet campaigns: one launchd job that runs open-game on a fixed interval
# with a staggered duration, so there is always something to play and closes never land together.
#
#   ops/schedule.sh install [every_hours]     # write + load the launchd job (default every 6h)
#   ops/schedule.sh start|stop|status|uninstall
#   ops/schedule.sh now [--dry-run]           # run one tick immediately (what launchd runs)
#   ops/schedule.sh log                       # follow the receipts
#
# Price and cap are fixed when the job is installed (SCHEDULE_PRICE / SCHEDULE_CAP override them).
# Duration is always 'auto': 6/10/14 hours rotating by wall-clock slot, so closes stagger.
set -euo pipefail

# The launchd plist hardcodes ROOT, so point it at a durable checkout
# (CRYPTOBALL_ROOT=...) rather than a disposable worktree: a job whose ROOT is a returned
# worktree keeps firing a path that no longer exists.
ROOT="${CRYPTOBALL_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
LABEL="site.cryptoball.open-game"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$ROOT/ops/log"
PRICE="${SCHEDULE_PRICE:-0.1}"
CAP="${SCHEDULE_CAP:-1000}"
# launchd starts jobs with PATH=/usr/bin:/bin:/usr/sbin:/sbin, so `command -v node` finds nothing and
# `set -e` kills the tick before it sends anything. Resolve node here or the job loads and never runs.
NODE="${SCHEDULE_NODE:-$(command -v node || true)}"
if [ -z "$NODE" ]; then
  for c in /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.volta/bin/node"; do
    [ -x "$c" ] && NODE="$c" && break
  done
fi
[ -n "$NODE" ] || { echo "schedule: no node found on PATH or in the usual prefixes - set SCHEDULE_NODE=/path/to/node" >&2; exit 1; }

run_tick() {
  mkdir -p "$LOG_DIR"
  # open-game appends one line per outcome (OPENED / DRYRUN / FAILED / REFUSED) to ops/log/open-game.log
  ( cd "$ROOT" && exec "$NODE" ops/open-game.mjs --price "$PRICE" --duration auto --cap "$CAP" ${@:+"$@"} ) \
    >>"$LOG_DIR/scheduler.log" 2>&1 || echo "open-game exited $? at $(date -u +%FT%TZ)" >>"$LOG_DIR/scheduler.log"
}

case "${1:-status}" in
  install)
    every="${2:-6}"
    mkdir -p "$HOME/Library/LaunchAgents"
    cat >"$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$ROOT/ops/schedule.sh</string>
    <string>tick</string>
  </array>
  <key>StartInterval</key><integer>$((every * 3600))</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$LOG_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/launchd.err.log</string>
</dict>
</plist>
PLIST_EOF
    chmod +x "$ROOT/ops/schedule.sh"
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$UID" "$PLIST"
    echo "installed $PLIST: every ${every}h, price ${PRICE} SOL, cap ${CAP}, duration auto (6/10/14h staggered)"
    echo "logs: $LOG_DIR/open-game.log (one line per run), $LOG_DIR/scheduler.log (stdout)"
    ;;
  tick|now)
    shift
    run_tick ${@:+"$@"}
    ;;
  start)
    launchctl kickstart -k "gui/$UID/$LABEL"
    echo "ran one tick now (and the job keeps its interval)"
    ;;
  stop)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    echo "stopped (the plist stays on disk; reload with: ops/schedule.sh install)"
    ;;
  uninstall)
    launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "removed $PLIST"
    ;;
  status)
    echo "plist: $PLIST"
    if [ -f "$PLIST" ]; then grep -A1 StartInterval "$PLIST" | tail -1; else echo "  (not installed)"; fi
    launchctl list "$LABEL" || echo "  (not loaded)"
    echo "log:   $LOG_DIR/open-game.log"
    [ -f "$LOG_DIR/open-game.log" ] && tail -5 "$LOG_DIR/open-game.log" || echo "  (no runs yet)"
    ;;
  log)
    tail -f "$LOG_DIR/open-game.log" "$LOG_DIR/scheduler.log"
    ;;
  *)
    sed -n '2,11p' "$0"
    exit 1
    ;;
esac
