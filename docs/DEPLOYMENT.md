# Deployment guide

## Backend (Docker)

```bash
# Build & run the full stack (api + postgres + redis)
docker compose up --build -d
# API on :4000, PostgreSQL on :5432, Redis on :6379
```

For a standalone image:

```bash
docker build -t tirelo-api .
docker run -p 4000:4000 --env-file .env tirelo-api
```

### Required environment variables

See `.env.example` for the full list. Production minimum:

| Var | Notes |
| --- | --- |
| `NODE_ENV` | `production` |
| `DB_DRIVER` | `postgres` (default) or `mongo` |
| `DATABASE_URL` | managed PostgreSQL connection string (when `DB_DRIVER=postgres`) |
| `MONGODB_URI` | managed MongoDB connection string (only when `DB_DRIVER=mongo`) |
| `JWT_SECRET` | long random secret |
| `PUBLIC_BASE_URL` | public URL (used in webhook/callback URLs) |
| `REDIS_URL` | enables shared cache (optional) |
| `GOOGLE_MAPS_API_KEY` | live maps (optional) |
| `FCM_SERVICE_ACCOUNT` + `PUSH_TRANSPORT=fcm` | push (optional) |
| Payment gateway keys | Orange Money / MyZaka / card (see `.env.example`) |

### PostgreSQL (default)

Use a managed instance (RDS, Cloud SQL, Neon, Supabase, …) reachable via
`DATABASE_URL`. Create a least-privilege app user/role. The base schema is
created idempotently on boot (`ensureSchema`); see [POSTGRES.md](./POSTGRES.md).
Enable daily automated snapshots (see Backups). To run on Mongo instead, set
`DB_DRIVER=mongo` + `MONGODB_URI` (a managed replica set, e.g. Atlas).

### Redis

Optional but recommended in multi-instance deployments so the cache and rate
limiting are shared. Set `REDIS_URL` and `npm i ioredis` (optional dep).

### Reverse proxy / HTTPS

Terminate TLS at nginx (sample in `deploy/nginx.conf.example`) and proxy to the
API. WebSocket upgrade headers are required for Socket.IO. Obtain certificates
with certbot:

```bash
certbot --nginx -d api.tirelo.example.com
```

### Logging & monitoring

Structured JSON request logs go to stdout (capture via your platform's log
driver). See `docs/MONITORING.md` for `/metrics`, health probes and crash
reporting.

### Backups & disaster recovery

- DB: nightly `pg_dump` (sample `deploy/backup.sh`; `mongodump` when on Mongo) to
  object storage, plus managed snapshots. Test restores quarterly.
- Uploads: if using local storage, back up the `uploads` volume; prefer cloud
  object storage (`STORAGE_DRIVER=s3|gcs|r2|azure`) in production.
- DR target: RPO ≤ 24h (snapshots) / RTO ≤ 1h (redeploy image + restore DB).

## Frontend

### PWA

```bash
cd mobile
npm ci
npx ng build --configuration production   # outputs www/ with service worker
```

Host `www/` on any static host/CDN (Firebase Hosting, Netlify, S3+CloudFront).
Ensure SPA fallback to `index.html` and HTTPS. Set the production API URL in
`mobile/src/environments/environment.prod.ts`.

### Android / iOS

See `docs/NATIVE_BUILD.md`.
