# Tirelo Services — PostgreSQL Benchmark Suite

A reproducible benchmark, profiling and tuning harness that validates
**PostgreSQL** as the production database for Tirelo Services and quantifies it
against the in-memory baseline and (optionally) MongoDB.

It exercises the application's **real repository layer** — the same methods the
services call — so results reflect production access patterns. Nothing in
`src/` business logic, the service layer, the payment module, the REST API, the
frontend or the auth flows is modified.

## Layout

```
benchmark/
  config.js            Sizes, connection, sample counts (all env-overridable)
  lib/
    stats.js           hrtime timing + p50/p95/p99/max + throughput
    random.js          deterministic RNG (mulberry32)
    botswana.js        geographic reference data (population-weighted)
    seed.js            dataset generator (all 15 domains, coherent graph)
    loader.js          driver-aware bulk loader (reuses repo column extractors)
    drivers.js         builds repo sets for postgres / memory / mongo
    pg-admin.js        EXPLAIN, table/index stats, pool sweep, forced plans
    reporter.js        JSON + Markdown emitter
  scenarios/
    repository-crud.js Phase 3  — CRUD across drivers
    search.js          Phase 12 — provider discovery filters + ranking
    workload.js        Phase 4  — marketplace flows
    concurrency.js     Phase 5/9 — concurrent load + pool sweep
    query-analysis.js  Phase 6/7/8 — EXPLAIN ANALYZE + index/JSONB validation
    payment.js         Phase 11 — payment latency + idempotency (module untouched)
    operational.js     Phase 14 — backup/restore/vacuum timings
  scripts/
    run-all.js         orchestrator (seed → run → report)
    seed.js            load a dataset into PostgreSQL
    analyze-queries.js print the query-analysis section for the current DB
  dashboard/index.html Phase 15 — static dashboard (reads reports/latest.json)
  reports/             generated JSON + Markdown (committed: small run)
  datasets/            generated dataset snapshots (reproducible from the seed)
```

## Running

A reachable PostgreSQL is required (the project default
`postgresql://postgres@localhost:5432/tirelo`, or set `BENCH_DATABASE_URL`).

```bash
# Full run at the default "small" dataset (1k users / 500 providers / 5k bookings)
npm run bench            # == node benchmark/scripts/run-all.js small

# Other sizes
node benchmark/scripts/run-all.js tiny      # fast smoke (CI)
node benchmark/scripts/run-all.js medium    # 50k / 10k / 250k
node benchmark/scripts/run-all.js large     # 500k / 100k / 5M (capacity testing)

# A subset of scenarios
node benchmark/scripts/run-all.js small --only=crud,search,query

# Seed only, then analyze queries against the live DB
npm run bench:seed -- small
npm run bench:queries
```

### Comparing against MongoDB

Set `BENCH_MONGODB_URI` to a reachable MongoDB; the orchestrator detects it and
adds Mongo columns to the cross-driver tables. If unset/unreachable it is
skipped and the suite still runs (PostgreSQL + in-memory).

### Tuning knobs (env)

| Var | Default | Purpose |
| --- | --- | --- |
| `BENCH_SIZE` | `small` | dataset size |
| `BENCH_DATABASE_URL` | project default | PostgreSQL connection |
| `BENCH_MONGODB_URI` | — | optional Mongo comparison |
| `BENCH_SEED` | `1337` | dataset RNG seed (reproducibility) |
| `BENCH_SAMPLES` | `2000` | per-op sample count |
| `BENCH_CONCURRENCY` | `50,100,250,500` | concurrent load levels |
| `BENCH_POOL_SIZES` | `5,10,20,40` | pool sizes to sweep |

## Output

Each run writes `reports/benchmark-<size>.json` (machine-readable),
`reports/benchmark-<size>.md` (human-readable) and `reports/latest.json` (for
the dashboard). Open `benchmark/dashboard/index.html` to browse the latest run
and load older report JSONs for trend comparison.

See [`docs/BENCHMARKING.md`](../docs/BENCHMARKING.md) for methodology and
[`docs/PERFORMANCE_REPORT.md`](../docs/PERFORMANCE_REPORT.md) for the analysed
results and tuning checklist.
