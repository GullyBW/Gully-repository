#!/usr/bin/env bash
# Nightly MongoDB backup for Tirelo Services.
# Schedule via cron, e.g.:  0 2 * * *  /opt/tirelo/deploy/backup.sh >> /var/log/tirelo-backup.log 2>&1
#
# Env:
#   MONGODB_URI         (required) mongodb connection string
#   BACKUP_DIR          (default /var/backups/tirelo)
#   RETENTION_DAYS      (default 14)
#   S3_BUCKET           (optional) if set, upload via `aws s3 cp`

set -euo pipefail

: "${MONGODB_URI:?MONGODB_URI is required}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tirelo}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/tirelo-${STAMP}.archive.gz"

mkdir -p "${BACKUP_DIR}"

echo "[backup] dumping to ${OUT}"
mongodump --uri="${MONGODB_URI}" --archive="${OUT}" --gzip

if [[ -n "${S3_BUCKET:-}" ]]; then
  echo "[backup] uploading to s3://${S3_BUCKET}/"
  aws s3 cp "${OUT}" "s3://${S3_BUCKET}/"
fi

echo "[backup] pruning backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name 'tirelo-*.archive.gz' -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] done"
