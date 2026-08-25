-- NJTIP persistence — migration 001 (PostgreSQL production target).
-- One table per (zone, collection): `<zone>__<collection>`. Rows are OPAQUE JSON
-- blobs keyed by an opaque key. There is deliberately NO identity column — reporter
-- identity is never stored (blueprint D-02); the domain layer rejects identity before
-- it can reach persistence. Zone isolation is enforced by separate schemas/roles in
-- production (a per-zone DB role cannot read another zone's schema).
--
-- Applied in-memory here by MemorySqlDriver; a real deployment runs this DDL via the
-- Postgres driver (docs/production-adapters.md). Example for the Independent zone:

CREATE SCHEMA IF NOT EXISTS zone_independent;

CREATE TABLE IF NOT EXISTS zone_independent."independent__reports" (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL,             -- opaque; no identity column exists
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zone_independent."independent__notifications" (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Executive / Judiciary zones use their OWN schema + DB role (no cross-zone grant).
CREATE SCHEMA IF NOT EXISTS zone_executive;
CREATE SCHEMA IF NOT EXISTS zone_judiciary;

-- Least-privilege roles (illustrative): each service role sees only its zone schema.
-- REVOKE ALL ON SCHEMA zone_judiciary FROM app_executive;  -- enforced in production
