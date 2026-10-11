#!/usr/bin/env bash
# Runs the service tests (the access rules, against a real MongoDB) without Docker.
#   npm run test:services:local
# Uses TEST_MONGODB_URI if set; otherwise starts a throw-away mongod (see scripts/lib/temp-mongo.sh).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/temp-mongo.sh
trap stop_temp_mongo EXIT
start_temp_mongo
echo "› service tests against $MONGO_BASE_URI"
npx vitest run tests/services "$@"
