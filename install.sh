#!/usr/bin/env bash
set -euo pipefail

if ! command -v npx >/dev/null 2>&1; then
  echo "Error: npx is required but was not found in PATH." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 is required but was not found in PATH." >&2
  exit 1
fi

read -rp "MySQL host [localhost]: " db_host
db_host=${db_host:-localhost}

read -rp "MySQL port [3306]: " db_port
db_port=${db_port:-3306}

read -rp "MySQL database name: " db_name
if [[ -z "$db_name" ]]; then
  echo "Database name cannot be empty." >&2
  exit 1
fi

read -rp "MySQL username: " db_user
if [[ -z "$db_user" ]]; then
  echo "Username cannot be empty." >&2
  exit 1
fi

read -srp "MySQL password (leave empty for none): " db_password
echo

python_encode() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import quote
value = sys.argv[1]
print(quote(value, safe=""))
PY
}

encoded_user=$(python_encode "$db_user")
encoded_password=$(python_encode "$db_password")

if [[ -z "$db_password" ]]; then
  connection_url="mysql://${encoded_user}@${db_host}:${db_port}/${db_name}"
else
  connection_url="mysql://${encoded_user}:${encoded_password}@${db_host}:${db_port}/${db_name}"
fi

env_file=".env.production"
if [[ -f "$env_file" ]]; then
  read -rp ".env.production already exists. Overwrite? [y/N]: " overwrite
  overwrite=${overwrite:-N}
  if [[ ! "$overwrite" =~ ^[Yy]$ ]]; then
    echo "Aborting without changes."
    exit 0
  fi
fi

tmp_file=$(mktemp)
if [[ -f .env.example ]]; then
  # Remove any existing DATABASE_URL entries before appending the new one
  grep -v '^DATABASE_URL=' .env.example > "$tmp_file" || true
else
  : > "$tmp_file"
fi

echo "DATABASE_URL=\"${connection_url}\"" >> "$tmp_file"

mv "$tmp_file" "$env_file"
chmod 600 "$env_file"

# 1. Exportă DATABASE_URL înainte de a rula comanda
# Folosim valoarea 'connection_url' pe care scriptul a generat-o deja.
export DATABASE_URL="$connection_url"

echo "Running Prisma migrations..."
# 2. Rulăm comanda simplificată, fără --env-file
# Deoarece schema este la calea implicită (prisma/schema.prisma), nici --schema nu e strict necesar, dar e bine să-l păstrăm.
npx prisma migrate deploy --schema prisma/schema.prisma 

# 3. Anulăm exportul (opțional, dar recomandat)
unset DATABASE_URL

echo "Generating Prisma client..."
npx prisma generate --schema prisma/schema.prisma

echo "Installation complete."
