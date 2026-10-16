#!/bin/sh
# Runs the database tests against a disposable PostgreSQL 17 cluster on loopback, then removes it.
#   brew install postgresql@17       (the binaries only; no service is started)
#   sh scripts/test-db.sh            (all tests)   |   sh scripts/test-db.sh tests/phase1-pricing-db.test.mjs
# PostgreSQL 17 matters: the migrations grant MAINTAIN, which older servers reject. Nothing here ever touches a real project: the
# tests themselves refuse any URL that is not loopback or that mentions supabase.
set -eu
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PSQL="${PSQL:-/opt/homebrew/opt/libpq/bin/psql}"
PORT="${ALPA_TEST_DB_PORT:-54329}"
DIR="$(mktemp -d /tmp/alpa-test-pg.XXXXXX)"
trap '"$PGBIN/pg_ctl" -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$PGBIN/initdb" -D "$DIR/data" -U postgres --auth=trust -E UTF8 --locale=C --wal-segsize=1 >/dev/null
mkdir -p "$DIR/sock"
"$PGBIN/pg_ctl" -D "$DIR/data" -w -l "$DIR/log" -o "-p $PORT -h 127.0.0.1 -k $DIR/sock -c fsync=off -c synchronous_commit=off -c wal_level=minimal -c max_wal_senders=0 -c max_wal_size=64MB -c min_wal_size=32MB -c autovacuum=off" start >/dev/null
# The roles a Supabase project provides; the test fixtures expect them to exist.
"$PSQL" -X -q -h 127.0.0.1 -p "$PORT" -U postgres -c "CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;"
export ALPA_TEST_DB_URL="postgres://postgres@127.0.0.1:$PORT/postgres"
if [ "$#" -eq 0 ]; then set -- tests/*.test.mjs; fi
node --test --test-concurrency=1 "$@"
