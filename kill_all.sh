#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/massage_robot.pid"
ENV_PORT=""
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  ENV_PORT="$(sed -n 's/^PORT=//p' "$SCRIPT_DIR/.env" | tail -1)"
fi
PORT="${PORT:-${ENV_PORT:-5033}}"

stopped=0

if [[ -f "$PIDFILE" ]]; then
  PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill "$PID" 2>/dev/null || true
    stopped=1
    for _ in {1..20}; do
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.1
    done
    if kill -0 "$PID" 2>/dev/null; then
      kill -9 "$PID" 2>/dev/null || true
    fi
  fi
  rm -f "$PIDFILE"
fi

if command -v lsof >/dev/null 2>&1; then
  while read -r PID; do
    [[ -z "$PID" ]] && continue
    CMD="$(ps -p "$PID" -o args= 2>/dev/null || true)"
    if [[ "$CMD" == *"$SCRIPT_DIR/main.py"* ]]; then
      kill "$PID" 2>/dev/null || true
      stopped=1
    fi
  done < <(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)
fi

if [[ "$stopped" -eq 1 ]]; then
  echo "Massage robot teaching platform stopped"
else
  echo "No massage robot teaching platform process found"
fi
