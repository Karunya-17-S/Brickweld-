#!/usr/bin/env bash
# Rebuild the local test DB from migrations, seed it with the workflow scenario, set test passwords.
set -e
cd "$(dirname "$0")/../.."
bash /home/claude/pgtest/build_bw.sh >/dev/null
PGHOST=/tmp PGPORT=54329 PGDATABASE=bw node tests/db/workflow.test.mjs | tail -1
psql -h /tmp -p 54329 -U postgres -d bw -qc "UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{\"pw\":\"Test@12345\"}'"
# (re)start the local API + static server
pkill -f "tests/e2e/shim.mjs" || true
sleep 0.5
PGDATABASE=bw nohup node tests/e2e/shim.mjs "${DIST:-/tmp/bwdist}" > /tmp/shim.log 2>&1 &
sleep 1.2
