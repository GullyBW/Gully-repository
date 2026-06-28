# Disaster recovery & operations

## Backups

- **Database:** nightly `deploy/backup.sh` (`mongodump --gzip --archive`) to object
  storage, plus managed provider snapshots. Retention 14 days (configurable).
- **Uploads:** if `STORAGE_DRIVER=local`, back up the `uploads` volume; prefer
  cloud object storage in production (`s3|gcs|r2|azure`) which has its own
  durability/versioning.
- Verify backups: run a **test restore** into a scratch database quarterly.

## Restore procedure

```bash
# Full restore from an archive
mongorestore --uri="$MONGODB_URI" --gzip --archive=/path/tirelo-YYYYmmdd.archive.gz --drop

# Single collection (e.g. bookings)
mongorestore --uri="$MONGODB_URI" --gzip --archive=... --nsInclude='tirelo.bookings'
```

After restore: bounce API instances (readiness probe gates traffic until Mongo
reconnects), then smoke-test `/health/ready`, login, a booking and a payment
webhook.

## Disaster recovery targets

- **RPO ≤ 24h** (nightly dump) — tighten with managed continuous backups / oplog.
- **RTO ≤ 1h** — redeploy the last good image tag + restore the latest snapshot.

### DR runbook
1. Provision/confirm a healthy MongoDB (managed failover or restore from snapshot).
2. Deploy the last known-good API image: `ghcr.io/<repo>:<sha>`.
3. Point `MONGODB_URI` / `REDIS_URL` at the recovered infra.
4. Verify `/health/ready`, run smoke checks, re-enable traffic at the proxy.
5. Re-arm backups; post-incident review.

## Rollback

- **API:** redeploy the previous image tag (immutable images make this instant).
  DB migrations are additive (no destructive schema changes), so rolling back the
  app does not require a DB rollback.
- **Mobile:** Play Store staged rollout halt + roll back to the previous release;
  App Store: expedited review or phased-release pause.

## Zero-downtime deployment

- Build immutable images; deploy with a **rolling update**.
- New pods/instances must pass `GET /health/ready` (checks Mongo + cache) before
  receiving traffic; old instances drain via graceful shutdown (SIGTERM →
  stop accepting, finish in-flight, close Mongo/cache, 10s force cap).
- Keep migrations **backward compatible** so old and new versions run together
  during the rollout.

## Incident response checklist

- [ ] Acknowledge alert (5xx spike / latency / down) — see `docs/MONITORING.md`.
- [ ] Check `/health/ready`, `/metrics`, recent deploys, error logs (by request id).
- [ ] Identify blast radius; if a bad deploy, **roll back** to previous image tag.
- [ ] If DB issue, fail over / restore; if dependency (Maps/FCM/gateway) down,
      confirm graceful degradation (sandbox/console fallbacks).
- [ ] Communicate status; once stable, write a post-incident review.

## Environment migration

1. Export config from `.env` (never commit secrets; use the platform vault).
2. Provision target Mongo/Redis; restore a snapshot if migrating data.
3. Update DNS/`PUBLIC_BASE_URL`; rotate secrets for the new environment.
4. Run the pipeline against the new environment (staging → production).
