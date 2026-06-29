# PostgreSQL (default database)

The backend runs on **PostgreSQL** by default (`DB_DRIVER=postgres`). MongoDB
remains available as an alternate driver (`DB_DRIVER=mongo`) — the service layer
is storage-agnostic via the repository pattern, so neither services nor the
payment module change.

## How it works

- `src/db/postgres.js` — a lazy `pg` connection pool + `ensureSchema()`.
- `src/db/schema.sql` — tables created idempotently on boot. Each table stores
  the full domain object in a **JSONB `doc`** column (the source of truth
  returned to services) plus a few extracted, indexed columns for filtering
  (`status`, `customer_id`, `category`, `created_at`, …).
- `src/repositories/postgres/index.js` — Postgres implementations of all 15
  repositories, matching the exact method set of the in-memory/Mongo versions.
- `src/repositories/index.js` builds the active set from `DB_DRIVER`.
- `src/server.js` runs `ensureSchema()` on startup (no separate migration step
  for the base schema); `/health/ready` pings Postgres.

## Configuration

```bash
DB_DRIVER=postgres
DATABASE_URL=postgresql://user:pass@host:5432/tirelo
```

## Run locally

```bash
# with Docker Compose (Postgres + Redis + API)
docker compose up --build

# or a standalone Postgres
docker run -d --name tirelo-pg -p 5432:5432 \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=tirelo \
  postgres:16-alpine
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/tirelo npm run dev
```

## Tests

- `npm test` — 111 unit/integration tests (in-memory repos; no DB needed).
- `npm run test:pg` — **integration tests against a real PostgreSQL**
  (`DATABASE_URL` required). Verifies auth + refresh rotation, provider
  discovery search (filter/sort/distance/text), booking → card payment webhook →
  settlement, messaging with JSONB reactions + read receipts, review rating
  recompute, saved-address default-clearing, favourites, and admin aggregations.
  Runs in CI via the `backend-pg` job with a Postgres service container.

## Notes & operations

- **Migrations:** the base schema is `CREATE TABLE IF NOT EXISTS` (additive,
  idempotent). For evolving columns/indexes in production, add a migration tool
  (e.g. `node-pg-migrate`) — the JSONB `doc` keeps field changes mostly additive.
- **Indexes:** defined in `schema.sql`. Add compound/GIN indexes (e.g. on
  `doc` JSONB paths) for hot query patterns as production load dictates.
- **Backups:** use `pg_dump`/`pg_restore` (replaces the Mongo `mongodump` in
  `deploy/backup.sh` when on Postgres) + managed snapshots.
- **Switching back to Mongo:** set `DB_DRIVER=mongo` + `MONGODB_URI`; no code
  changes.
