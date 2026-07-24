-- NJTIP persistence — migration 002 (optimistic locking + read/write optimisation).
-- Adds a monotonic row VERSION for compare-and-swap writes (lost-update prevention) and
-- indexes for read optimisation. Still NO identity column — rows remain opaque JSON blobs.
-- Applied in-memory by MemorySqlDriver (rows carry an internal version); a real deployment
-- runs this DDL via the Postgres driver. Example for the Independent zone:

ALTER TABLE zone_independent."independent__reports"
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE zone_independent."independent__notifications"
  ADD COLUMN IF NOT EXISTS version BIGINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Read optimisation: JSONB GIN index for containment queries on non-identifying fields
-- (e.g. status/category projections). Never indexes identity — none exists.
CREATE INDEX IF NOT EXISTS ix_independent_reports_value
  ON zone_independent."independent__reports" USING GIN (value);

-- Optimistic-lock write pattern (executed by the driver's casUpsert):
--   UPDATE zone_independent."independent__reports"
--      SET value = $2, version = version + 1, updated_at = now()
--    WHERE key = $1 AND version = $3;      -- 0 rows affected == version conflict
--
-- Read/write split: writes go to the primary; read-only projections (dashboards, search)
-- may target a read replica. The driver selects the connection; the domain is unaware.
