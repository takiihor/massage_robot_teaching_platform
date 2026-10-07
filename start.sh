#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ENV_PORT=""
ENV_HOST=""
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  ENV_PORT="$(sed -n 's/^PORT=//p' "$SCRIPT_DIR/.env" | tail -1)"
  ENV_HOST="$(sed -n 's/^HOST=//p' "$SCRIPT_DIR/.env" | tail -1)"
fi
PORT="${PORT:-${ENV_PORT:-5033}}"
HOST="${HOST:-${ENV_HOST:-127.0.0.1}}"
PIDFILE="$SCRIPT_DIR/massage_robot.pid"
LOGFILE="$SCRIPT_DIR/server.log"

if [[ -f "$PIDFILE" ]]; then
  OLD_PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "$OLD_PID" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Already running on pid $OLD_PID"
    echo "Health: http://127.0.0.1:${PORT}/health"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

if [[ -d "$SCRIPT_DIR/venv" ]]; then
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/venv/bin/activate"
fi

export PORT HOST
python3 "$SCRIPT_DIR/main.py" > "$LOGFILE" 2>&1 &
PID="$!"
echo "$PID" > "$PIDFILE"

cleanup() {
  if kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
}
trap cleanup INT TERM

for _ in {1..40}; do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "Started massage robot teaching platform"
    echo "PID: $PID"
    echo "URL: http://127.0.0.1:${PORT}/"
    wait "$PID"
    exit $?
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Server exited during startup"
    tail -80 "$LOGFILE" || true
    rm -f "$PIDFILE"
    exit 1
  fi
  sleep 0.25
done

echo "Server did not pass health check on port ${PORT}"
tail -80 "$LOGFILE" || true
cleanup
exit 1
