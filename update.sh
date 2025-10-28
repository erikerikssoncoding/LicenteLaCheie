#!/usr/bin/env bash
set -euo pipefail

env_file=".env.production"
if [[ ! -f "$env_file" ]]; then
  echo "Error: $env_file not found. Please run install.sh first." >&2
  exit 1
fi

original_database_url_set=0
if [[ -v DATABASE_URL ]]; then
  original_database_url="$DATABASE_URL"
  original_database_url_set=1
fi

cleanup() {
  if [[ $original_database_url_set -eq 1 ]]; then
    export DATABASE_URL="$original_database_url"
  else
    unset DATABASE_URL || true
  fi
}

trap cleanup EXIT

set -a
source "$env_file"
set +a

if ! command -v npx >/dev/null 2>&1; then
  echo "Error: npx is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required but was not found in PATH." >&2
  exit 1
fi

status_json=$(npx prisma migrate status --schema prisma/schema.prisma --json)

unapplied_count=$(python3 -c '
import json
import sys
try:
    data = json.loads(sys.stdin.read())
except json.JSONDecodeError as exc:
    print(f"Failed to parse Prisma migrate status JSON: {exc}", file=sys.stderr)
    sys.exit(1)
print(len(data.get("unappliedMigrationNames", [])))
' <<<"$status_json")

if [[ "$unapplied_count" -eq 0 ]]; then
  echo "Database schema is already up to date."
  exit 0
fi

echo "There are $unapplied_count pending Prisma migration(s)."
read -rp "Apply migrations now? [y/N]: " confirm
confirm=${confirm:-N}
if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
  echo "Aborting without applying migrations."
  exit 1
fi

npx prisma migrate deploy --schema prisma/schema.prisma

echo "Migrations applied successfully."
