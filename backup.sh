#!/usr/bin/env bash
# scripts/backup.sh
# Daily PostgreSQL backup → S3 with 30-day retention.
# Run via Railway cron or crontab:  0 2 * * * bash /app/scripts/backup.sh

set -euo pipefail

DATE=$(date -u +%Y%m%d-%H%M%S)
BACKUP_FILE="indus-backup-${DATE}.sql.gz"
TMP="/tmp/${BACKUP_FILE}"

log() { echo "[$(date -u +%H:%M:%S)] $*"; }

# ─── Validate env ────────────────────────────────────────────
: "${DATABASE_URL:?DATABASE_URL not set}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET not set}"
: "${BACKUP_S3_REGION:=ap-south-1}"

log "Starting backup: ${BACKUP_FILE}"

# ─── Dump ────────────────────────────────────────────────────
pg_dump "$DATABASE_URL" \
  --no-owner \
  --no-acl \
  --clean \
  --if-exists \
  | gzip > "$TMP"

SIZE=$(du -sh "$TMP" | cut -f1)
log "Dump complete: ${SIZE}"

# ─── Upload to S3 ────────────────────────────────────────────
if command -v aws &>/dev/null; then
  aws s3 cp "$TMP" "s3://${BACKUP_S3_BUCKET}/daily/${BACKUP_FILE}" \
    --region "$BACKUP_S3_REGION" \
    --storage-class STANDARD_IA

  log "Uploaded to s3://${BACKUP_S3_BUCKET}/daily/${BACKUP_FILE}"

  # ─── Delete backups older than 30 days ───────────────────────
  CUTOFF=$(date -u -d '30 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || \
           date -u -v-30d +%Y-%m-%dT%H:%M:%SZ)

  DELETED=$(aws s3api list-objects-v2 \
    --bucket "$BACKUP_S3_BUCKET" \
    --prefix "daily/" \
    --query "Contents[?LastModified<='${CUTOFF}'].Key" \
    --output text | tr '\t' '\n' | grep -v '^$' || true)

  if [[ -n "$DELETED" ]]; then
    echo "$DELETED" | while read -r key; do
      aws s3 rm "s3://${BACKUP_S3_BUCKET}/${key}"
      log "Deleted old backup: ${key}"
    done
  fi
else
  log "WARNING: AWS CLI not found — backup stored locally only at ${TMP}"
  # Copy to a local backup dir as fallback
  mkdir -p /var/backups/indus
  cp "$TMP" "/var/backups/indus/${BACKUP_FILE}"
  # Keep only last 7 local backups
  ls -t /var/backups/indus/*.gz 2>/dev/null | tail -n +8 | xargs -r rm
fi

# ─── Slack notification ───────────────────────────────────────
if [[ -n "${SLACK_WEBHOOK_URL:-}" ]]; then
  curl -sf -X POST "$SLACK_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\": \"✅ Indus backup complete: \`${BACKUP_FILE}\` (${SIZE})\"}" || true
fi

rm -f "$TMP"
log "Backup done."
