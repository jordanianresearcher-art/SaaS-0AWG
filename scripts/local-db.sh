#!/usr/bin/env bash
# Spin up a throwaway Postgres, apply every migration, and hand you a psql
# prompt — so migrations and analysis SQL can be proven before they touch a
# live shop's database.
#
# This closes a gap the project has recorded the hard way. From the merge
# plan: "a migration applying cleanly is not evidence its functions run."
# Until now the only way to find out was for the owner to paste SQL into the
# production SQL editor and see what happened. Now the whole ledger can be
# replayed from scratch in about ten seconds against a real Postgres.
#
#   scripts/local-db.sh              apply migrations, then open psql
#   scripts/local-db.sh --seed       also load supabase/seed.sql
#   scripts/local-db.sh -f FILE.sql  apply migrations, run FILE, print results
#   scripts/local-db.sh --stop       tear the server down
#
# NOTE: this is a stub of Supabase, not Supabase. It creates the `anon`,
# `authenticated` and `service_role` roles and minimal `auth`/`storage`
# schemas so the migrations' GRANTs and RLS policies parse. It does NOT
# reproduce Supabase's real auth, storage helpers, or JWT claims — so RLS
# behaviour here proves the policy compiles, never that it protects. Two
# storage-policy migrations (0017, 0018) fail on `storage.foldername`, which
# Supabase provides and this stub does not; that is expected and harmless for
# schema and query work.

set -uo pipefail

PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/tmp/og-localdb
PGPORT=55432
PGSOCK=/tmp
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! [ -x "$PGBIN/postgres" ]; then
  echo "No Postgres 16 at $PGBIN — this script only runs where one is installed." >&2
  exit 1
fi

# Everything runs as the postgres user; initdb refuses to run as root.
pg() { su postgres -c "PATH=$PGBIN:\$PATH $*"; }

if [ "${1:-}" = "--stop" ]; then
  pg "pg_ctl -D $PGDATA stop" >/dev/null 2>&1 && echo "stopped." || echo "not running."
  exit 0
fi

echo "==> fresh cluster at $PGDATA"
pg "pg_ctl -D $PGDATA stop" >/dev/null 2>&1
rm -rf "$PGDATA"; mkdir -p "$PGDATA"; chown postgres:postgres "$PGDATA"
pg "initdb -D $PGDATA --auth=trust" >/dev/null 2>&1
pg "pg_ctl -D $PGDATA -o '-k $PGSOCK -p $PGPORT -c listen_addresses=\"\"' -l /tmp/og-localdb.log start" >/dev/null 2>&1
sleep 2

echo "==> roles and Supabase-provided schemas (stubbed)"
pg "psql -h $PGSOCK -p $PGPORT -d postgres -q -c \"do \\\$\\\$ begin
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
end \\\$\\\$;\" -c 'drop database if exists og' -c 'create database og'" >/dev/null 2>&1

pg "psql -h $PGSOCK -p $PGPORT -d og -q -c \"
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists extensions;
create schema if not exists storage;
create table if not exists auth.users (id uuid primary key default gen_random_uuid(), email text);
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
create or replace function auth.uid() returns uuid language sql stable as \\\$\\\$ select null::uuid \\\$\\\$;
create or replace function auth.role() returns text language sql stable as \\\$\\\$ select 'authenticated'::text \\\$\\\$;
\"" >/dev/null 2>&1

echo "==> applying migrations"
failed=0
for f in "$REPO"/supabase/migrations/*.sql; do
  cp "$f" /tmp/_m.sql; chmod 644 /tmp/_m.sql
  if pg "psql -h $PGSOCK -p $PGPORT -d og -q -v ON_ERROR_STOP=1 -f /tmp/_m.sql" >/tmp/_m.log 2>&1; then
    printf '    ok   %s\n' "$(basename "$f")"
  else
    printf '  FAIL   %s — %s\n' "$(basename "$f")" "$(grep -m1 ERROR /tmp/_m.log)"
    failed=$((failed + 1))
  fi
done
echo "==> $failed migration(s) failed (0017/0018 expected: storage.foldername is Supabase-only)"

if [ "${1:-}" = "--seed" ]; then
  cp "$REPO/supabase/seed.sql" /tmp/_s.sql; chmod 644 /tmp/_s.sql
  pg "psql -h $PGSOCK -p $PGPORT -d og -q -f /tmp/_s.sql" >/dev/null 2>&1 && echo "==> seed loaded"
  shift
fi

if [ "${1:-}" = "-f" ] && [ -n "${2:-}" ]; then
  cp "$2" /tmp/_q.sql; chmod 644 /tmp/_q.sql
  echo "==> running $2"
  pg "psql -h $PGSOCK -p $PGPORT -d og -f /tmp/_q.sql"
  exit $?
fi

echo "==> connect with:"
echo "    su postgres -c \"PATH=$PGBIN:\\\$PATH psql -h $PGSOCK -p $PGPORT -d og\""
echo "    scripts/local-db.sh --stop   # when done"
