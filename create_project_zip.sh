#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${1:-$SCRIPT_DIR}"

if [[ ! -d "$PROJECT_DIR" ]]; then
  echo "Error: project directory not found: $PROJECT_DIR" >&2
  exit 1
fi

PROJECT_NAME="$(basename "$PROJECT_DIR")"
PARENT_DIR="$(dirname "$PROJECT_DIR")"
OUT_ZIP="${2:-$PARENT_DIR/${PROJECT_NAME}_$(date +%Y%m%d_%H%M%S).zip}"

cd "$PARENT_DIR"

zip -r "$OUT_ZIP" "$PROJECT_NAME" \
  -x "*/.venv/*" "*/venv/*" "*/node_modules/*"

echo "Created: $OUT_ZIP"
