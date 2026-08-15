#!/usr/bin/env bash
#
# Applies the migrations to a throwaway Postgres and asserts the schema's
# security and compliance guarantees actually hold.
#
# Runs against a plain PostgreSQL 16 instance — no Docker, no Supabase account.
# `00_supabase_prelude.sql` stands in for the parts of a real project the
# migrations depend on: the anon/authenticated/service_role roles, the auth
# schema, auth.uid(), and Supabase's default grants in the public schema.
#
# Usage:
#   supabase/tests/run.sh                     # starts a temporary cluster
#   PGPORT=5432 PGHOST=localhost supabase/tests/run.sh   # use an existing one

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-55432}"
PGUSER="${PGUSER:-postgres}"
DBNAME="${DBNAME:-lefta_test}"

OWN_CLUSTER=0
PGROOT="${PGROOT:-/var/lib/postgresql/lefta-test}"

cleanup() {
  if [[ "$OWN_CLUSTER" == "1" ]]; then
    su postgres -c "$PGBIN/pg_ctl -D $PGROOT/data stop -m immediate" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if ! psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -c 'select 1' >/dev/null 2>&1; then
  echo "No server on $PGHOST:$PGPORT — starting a temporary cluster."

  PGBIN="$(dirname "$(readlink -f "$(command -v initdb || echo /usr/lib/postgresql/16/bin/initdb)")")"
  rm -rf "$PGROOT"
  mkdir -p "$PGROOT"
  chown postgres:postgres "$PGROOT"

  su postgres -c "$PGBIN/initdb -D $PGROOT/data -A trust -U postgres" >/dev/null
  su postgres -c "$PGBIN/pg_ctl -D $PGROOT/data -o '-p $PGPORT -k /tmp' -l $PGROOT/server.log start" >/dev/null
  OWN_CLUSTER=1
  sleep 2
fi

PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -c "drop database if exists $DBNAME;" -c "create database $DBNAME;"
"${PSQL[@]}" -d "$DBNAME" -f "$HERE/00_supabase_prelude.sql" 2>/dev/null

for migration in "$MIGRATIONS"/*.sql; do
  echo "applying $(basename "$migration")"
  "${PSQL[@]}" -d "$DBNAME" -f "$migration"
done

echo
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DBNAME" -v ON_ERROR_STOP=1 -f "$HERE/01_schema_checks.sql"
