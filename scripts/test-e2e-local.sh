#!/usr/bin/env bash
# End-to-end browser tests without Docker.
#
#   MongoDB (throw-away database)  ←  production build of this app  ←  Playwright
#   local SMTP sink (tests/support/mail-sink.mjs)  ←  Nodemailer in the app
#
# The app is the real production build talking to a real MongoDB and sending
# real SMTP mail; only the mailbox is local.
#
#   bash scripts/test-e2e-local.sh            run the tests, then shut everything down
#   bash scripts/test-e2e-local.sh --serve    keep the stack running for manual use
#
# MongoDB: TEST_MONGODB_URI if set, otherwise a throw-away mongod is started
# (needs `mongod` on PATH). First run: npx playwright install chromium
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PORT="${E2E_APP_PORT:-3100}"
SMTP_PORT_E2E="${E2E_SMTP_PORT:-2525}"
MAIL_API_PORT="${E2E_MAIL_API_PORT:-2526}"
MODE="${1:-test}"

source "$ROOT/scripts/lib/temp-mongo.sh"

PIDS=()
cleanup() {
  for pid in "${PIDS[@]:-}"; do kill "$pid" >/dev/null 2>&1 || true; done
  if [ -n "${MONGODB_URI:-}" ] && [ "${E2E_KEEP_DB:-0}" != "1" ]; then
    node "$ROOT/tests/support/drop-database.mjs" >/dev/null 2>&1 || true
  fi
  stop_temp_mongo
}
trap cleanup EXIT

wait_for() {
  for _ in $(seq 1 80); do
    if curl -fsS -o /dev/null "$1" 2>/dev/null; then return 0; fi
    sleep 0.5
  done
  echo "Timed out waiting for $1" >&2; exit 1
}

for port in "$APP_PORT" "$MAIL_API_PORT"; do
  if curl -s -o /dev/null "http://127.0.0.1:$port/"; then
    echo "Port $port is already in use. Stop whatever is running there (an earlier test run?) and try again." >&2; exit 1
  fi
done

start_temp_mongo
cd "$ROOT"

# A database of its own for this run; dropped at the end.
MONGO_QUERY=""
case "$MONGO_BASE_URI" in *\?*) MONGO_QUERY="?${MONGO_BASE_URI#*\?}"; MONGO_BASE_URI="${MONGO_BASE_URI%%\?*}";; esac
export MONGODB_URI="${MONGO_BASE_URI%/}/cpf_e2e_$(date +%s)_$$${MONGO_QUERY}"

# Server output goes to files, so the tests can check that nothing private is
# ever written to the logs.
export E2E_LOG_DIR="${E2E_LOG_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/cpf-logs.XXXXXX")}"
mkdir -p "$E2E_LOG_DIR"
export E2E_SERVER_LOG="$E2E_LOG_DIR/app.log"
echo "› server logs: $E2E_LOG_DIR"

node tests/support/mail-sink.mjs "$SMTP_PORT_E2E" "$MAIL_API_PORT" > "$E2E_LOG_DIR/mail.log" 2>&1 &
PIDS+=($!)
wait_for "http://127.0.0.1:$MAIL_API_PORT/health"

export APP_URL="http://127.0.0.1:$APP_PORT"
export SMTP_HOST="127.0.0.1"
export SMTP_PORT="$SMTP_PORT_E2E"
export SMTP_USER="" SMTP_PASS=""
export EMAIL_FROM="Campus Partner Finder <no-reply@campus.test>"
export E2E_BASE_URL="$APP_URL"
export E2E_MAIL_API="http://127.0.0.1:$MAIL_API_PORT"
export NEXT_TELEMETRY_DISABLED=1

echo "› building the app"
npx next build >/dev/null
# Started with node directly (not npx) so the recorded PID is the server itself and cleanup really stops it.
node node_modules/next/dist/bin/next start -p "$APP_PORT" -H 127.0.0.1 > "$E2E_SERVER_LOG" 2>&1 &
PIDS+=($!)
wait_for "$E2E_BASE_URL/"

if [ "$MODE" = "--serve" ]; then
  echo "› app:      $E2E_BASE_URL"
  echo "› database: (the throw-away database of this run)"
  echo "› mail:     $E2E_MAIL_API/messages"
  echo "› Ctrl-C to stop"
  wait
else
  npx playwright test --config tests/e2e/playwright.config.mjs "${@:1}"
fi
