#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "Created .env from .env.example"
fi

set -a
source "$ROOT/.env"
set +a

echo "Starting Postgres..."
docker compose -f "$ROOT/docker-compose.yml" up -d --wait

echo "Running migrations..."
npm run --workspace=packages/db db:migrate

echo "Seeding database..."
npm run --workspace=packages/db db:seed

echo "Done. Run 'npm run dev' to start the app."
