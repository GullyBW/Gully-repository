#!/usr/bin/env bash
# Nightly database backup for Tirelo Services.
# Schedule via cron, e.g.:  0 2 * * *  /opt/tirelo/deploy/backup.sh >> /var/log/tirelo-backup.log 2>&1
#
# Defaults to PostgreSQL (the default DB_DRIVER). Set DB_DRIVER=mongo for Mongo.
#
# Env:
#   DB_DRIVER           (default postgres) — 'postgres' or 'mongo'
#   DATABASE_URL        (postgres) connection string, e.g. postgresql://user:pass@host:5432/tirelo
#   MONGODB_URI         (mongo) connection string
#   BACKUP_DIR          (default /var/backups/tirelo)
#   RETENTION_DAYS      (default 14)
#   S3_BUCKET           (optional) if set, upload via `aws s3 cp`

set -euo pipefail

DB_DRIVER="${DB_DRIVER:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/tirelo}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "${BACKUP_DIR}"

if [[ "${DB_DRIVER}" == "mongo" ]]; then
  : "${MONGODB_URI:?MONGODB_URI is required when DB_DRIVER=mongo}"
  OUT="${BACKUP_DIR}/tirelo-${STAMP}.archive.gz"
  echo "[backup] mongodump to ${OUT}"
  mongodump --uri="${MONGODB_URI}" --archive="${OUT}" --gzip
  PATTERN='tirelo-*.archive.gz'
else
  : "${DATABASE_URL:?DATABASE_URL is required when DB_DRIVER=postgres}"
  OUT="${BACKUP_DIR}/tirelo-${STAMP}.dump"
  echo "[backup] pg_dump to ${OUT}"
  # custom format (-Fc) is compressed and restorable with pg_restore
  pg_dump --dbname="${DATABASE_URL}" --format=custom --file="${OUT}"
  PATTERN='tirelo-*.dump'
fi

if [[ -n "${S3_BUCKET:-}" ]]; then
  echo "[backup] uploading to s3://${S3_BUCKET}/"
  aws s3 cp "${OUT}" "s3://${S3_BUCKET}/"
fi

echo "[backup] pruning backups older than ${RETENTION_DAYS} days"
find "${BACKUP_DIR}" -name "${PATTERN}" -mtime "+${RETENTION_DAYS}" -delete

echo "[backup] done"
