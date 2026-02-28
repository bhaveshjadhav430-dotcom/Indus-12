#!/usr/bin/env bash
# scripts/migrate-and-start.sh
# Run this as the Railway start command for API.
# It runs migrations + optional seed, then starts the server.
set -euo pipefail

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

log "Running Prisma migrations..."
npx prisma migrate deploy --schema=./prisma/schema.prisma

# Seed only on first deploy (when SEED_ON_DEPLOY=true)
if [[ "${SEED_ON_DEPLOY:-false}" == "true" ]]; then
  log "Seeding database..."
  npx tsx prisma/seed.ts
  log "Seed complete."
fi

log "Starting API..."
exec node dist/server.js
