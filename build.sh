#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

INSTALL_PLAYWRIGHT=1
RUN_TESTS=0

for arg in "$@"; do
  case "$arg" in
    --skip-playwright)
      INSTALL_PLAYWRIGHT=0
      ;;
    --with-tests)
      RUN_TESTS=1
      ;;
    -h|--help)
      cat <<'HELP'
Usage: ./build.sh [--skip-playwright] [--with-tests]

Prepare the Massage Robot Teaching Platform after cloning or pulling:
  - create/update Python virtual environment in ./venv
  - install Python dependencies from requirements.txt
  - install Node dependencies from package-lock.json
  - install Playwright Chromium browser unless skipped
  - create .env from .env.example if missing

Options:
  --skip-playwright   Skip browser download for Playwright E2E tests
  --with-tests        Run npm test after installing dependencies
HELP
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run ./build.sh --help for usage." >&2
      exit 2
      ;;
  esac
done

missing=()
for cmd in python3 node npm curl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    missing+=("$cmd")
  fi
done

if ((${#missing[@]} > 0)); then
  echo "Missing required command(s): ${missing[*]}" >&2
  echo "Install them first, for example:" >&2
  echo "  sudo apt update && sudo apt install -y python3 python3-venv python3-pip nodejs npm curl" >&2
  exit 1
fi

if [[ ! -d venv ]]; then
  python3 -m venv venv || {
    echo "Failed to create venv. On Ubuntu install python3-venv:" >&2
    echo "  sudo apt update && sudo apt install -y python3-venv" >&2
    exit 1
  }
fi

# shellcheck source=/dev/null
source venv/bin/activate
python -m pip install --upgrade pip wheel
python -m pip install -r requirements.txt

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

if [[ "$INSTALL_PLAYWRIGHT" -eq 1 ]]; then
  npx playwright install chromium
fi

if [[ ! -f .env && -f .env.example ]]; then
  cp .env.example .env
  echo "Created .env from .env.example. Fill API keys before using cloud ASR/TTS."
fi

if [[ "$RUN_TESTS" -eq 1 ]]; then
  npm test
fi

cat <<'DONE'

Build/setup complete.

Start the app:
  ./start.sh

Default URL:
  http://127.0.0.1:5033/
DONE
