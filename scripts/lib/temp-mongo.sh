#!/usr/bin/env bash
# Gives the test scripts a MongoDB to use, without Docker.
#
#   source scripts/lib/temp-mongo.sh
#   start_temp_mongo      # exports MONGO_BASE_URI (no database name)
#   stop_temp_mongo
#
# If TEST_MONGODB_URI is set (for example "mongodb://127.0.0.1:27017"), that
# server is used and nothing is started or stopped. Otherwise a throw-away
# mongod is started on a free port with its data in a temporary folder — this
# needs the `mongod` binary on PATH (or its path in MONGOD_BIN).
# Tests create their own uniquely named databases and drop them afterwards.

TEMP_MONGO_DIR=""
TEMP_MONGO_PID=""

start_temp_mongo() {
  if [ -n "${TEST_MONGODB_URI:-}" ]; then
    export MONGO_BASE_URI="${TEST_MONGODB_URI%/}"
    return 0
  fi
  local bin="${MONGOD_BIN:-$(command -v mongod || true)}"
  if [ -z "$bin" ]; then
    echo "No MongoDB to test against: install MongoDB (mongod on PATH), or set TEST_MONGODB_URI to a server you can use for throw-away databases." >&2
    return 1
  fi
  TEMP_MONGO_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cpf-mongotest.XXXXXX")"
  local port="${TEMP_MONGO_PORT:-27129}"
  "$bin" --dbpath "$TEMP_MONGO_DIR" --port "$port" --bind_ip 127.0.0.1 --logpath "$TEMP_MONGO_DIR/mongod.log" >/dev/null 2>&1 &
  TEMP_MONGO_PID=$!
  for _ in $(seq 1 60); do
    if grep -q "aiting for connections" "$TEMP_MONGO_DIR/mongod.log" 2>/dev/null; then
      export MONGO_BASE_URI="mongodb://127.0.0.1:$port"
      return 0
    fi
    sleep 0.5
  done
  echo "mongod did not start; see $TEMP_MONGO_DIR/mongod.log" >&2
  return 1
}

stop_temp_mongo() {
  if [ -n "$TEMP_MONGO_PID" ]; then
    kill "$TEMP_MONGO_PID" 2>/dev/null || true
    wait "$TEMP_MONGO_PID" 2>/dev/null || true
    TEMP_MONGO_PID=""
  fi
  if [ -n "$TEMP_MONGO_DIR" ]; then rm -rf "$TEMP_MONGO_DIR"; TEMP_MONGO_DIR=""; fi
}
