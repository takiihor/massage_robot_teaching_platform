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

# --- Explicit export policy -------------------------------------------------
# Everything below is excluded from the shareable archive so that local secrets,
# credentials, runtime state and build artifacts never leave the machine.
# Keep this list as the maintained source of truth for what must NOT ship.
EXCLUDES=(
  # dependencies / environments
  "*/venv/*" "*/.venv/*" "*/node_modules/*" "*/__pycache__/*" "*.pyc"
  # secrets & local config (the .env.example template is re-added below)
  "*/.env" "*/.env.*"
  "*.pem" "*.key" "*.crt" "*/certs/*"
  # runtime state / logs / pid
  "*/.massage_state/*" "*/logs/*" "*.log" "*.pid"
  "*/server.log" "*/massage_robot.pid" "*/robot/calibration_data.json"
  # test / build artifacts
  "*/test-results/*" "*/playwright-report/*" "*/coverage/*" "*/.nyc_output/*"
  # version control & tool/editor metadata
  "*/.git/*" "*/.git" "*/.claude/*" "*/.qoder/*" "*/.idea/*" "*/.vscode/*"
  # generated archives
  "*.zip" "*.tar" "*.tar.gz"
  # OS noise
  "*/.DS_Store" ".DS_Store" "*/Thumbs.db"
)

cd "$PARENT_DIR"

if [[ "${PRINT_EXCLUDES:-0}" == "1" ]]; then
  printf '%s\n' "${EXCLUDES[@]}"
  exit 0
fi

zip -r "$OUT_ZIP" "$PROJECT_NAME" -x "${EXCLUDES[@]}"

# Re-add the safe, secret-free environment template (the blanket .env.* rule
# above excludes it along with real .env files).
if [[ -f "$PROJECT_NAME/.env.example" ]]; then
  zip -q "$OUT_ZIP" "$PROJECT_NAME/.env.example"
fi

echo "Created: $OUT_ZIP"
