#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pg_bin="${PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}"
mkdir -p .local
if [ ! -f .local/pg/PG_VERSION ]; then
  "$pg_bin/initdb" -D .local/pg -U radar -A trust --encoding=UTF8 --locale=C >/dev/null
fi
if ! "$pg_bin/pg_ctl" -D .local/pg status >/dev/null 2>&1; then
  "$pg_bin/pg_ctl" -D .local/pg -l .local/postgres.log -o "-p 55432 -h 127.0.0.1 -k $(pwd)/.local" start
fi
if ! "$pg_bin/psql" -h 127.0.0.1 -p 55432 -U radar -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='radar'" | tr -d ' ' | rg -q '^1$'; then
  "$pg_bin/createdb" -h 127.0.0.1 -p 55432 -U radar radar
fi
if [ ! -f .env ]; then cp .env.example .env; fi
