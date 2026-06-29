# Tirelo Services — PostgreSQL Benchmark Report

_Generated: 2026-06-29T18:34:56.325Z_

## Environment

| Property | Value |
| --- | --- |
| datasetSize | small |
| users | 1000 |
| providers | 500 |
| bookings | 5000 |
| seed | 1337 |
| drivers | postgres, memory |
| node | v22.22.2 |
| cpu | Intel(R) Xeon(R) Processor @ 2.80GHz × 4 |
| memoryGB | 16 |
| platform | Linux 6.18.5 |
| pgVersion | 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) |
| sharedBuffers | 16384 8kB |
| workMem | 4096 kB |
| maxConnections | 100 |

## Dataset load (bulk insert)

Time to bulk-load the full generated dataset into each driver.

### Load throughput

| Driver | Load time (ms) | rows/s |
| --- | --- | --- |
| postgres | 941 | 23681 |
| memory | 19 | 1181841 |

- Total rows per driver: 22275.

## Phase 3 — Repository CRUD performance

Per-operation latency and throughput through the repository interface (notification domain). In-memory is the theoretical ceiling; PostgreSQL includes real network + durability cost.

### Comparison across drivers (1500 samples)

| Operation | postgres p50 (ms) | postgres p95 (ms) | postgres ops/s | memory p50 (ms) | memory p95 (ms) | memory ops/s |
| --- | --- | --- | --- | --- | --- | --- |
| create | 1.088 | 1.311 | 899.498 | 0.001 | 0.002 | 500662.543 |
| readById | 0.255 | 0.361 | 3686.824 | 0.001 | 0.001 | 1085751.966 |
| update | 1.336 | 1.608 | 737.371 | 0.001 | 0.002 | 723149.461 |
| listByUser | 0.275 | 0.358 | 3491.672 | 0.434 | 0.499 | 2262.488 |
| countUnread | 0.358 | 0.422 | 2738.74 | 0.083 | 0.125 | 10732.687 |

- All drivers expose the identical method set — the repository abstraction is unchanged.
- p50/p95 in milliseconds; ops/s is sustained sequential throughput.

## Phase 12 — Provider discovery / search performance

Search filter latency at the "small" dataset (500 providers).

### Filter latency by driver

| Filter | Rows | postgres p50 (ms) | postgres p95 (ms) | memory p50 (ms) | memory p95 (ms) |
| --- | --- | --- | --- | --- | --- |
| category only | 47 | 0.873 | 1.168 | 0.02 | 0.033 |
| verified + available | 205 | 1.32 | 2.074 | 0.029 | 0.049 |
| price ceiling | 301 | 1.828 | 2.716 | 0.037 | 0.07 |
| min rating 4.0 | 334 | 2.048 | 3.161 | 0.042 | 0.077 |
| text search | 34 | 1.758 | 2.157 | 0.169 | 0.237 |
| category + price + rating | 26 | 0.713 | 0.862 | 0.028 | 0.038 |

### Ranking (in-process sort on category result set)

| Sort | p50 (ms) | p95 (ms) | ops/s |
| --- | --- | --- | --- |
| highestRated | 0.005 | 0.007 | 171222.483 |
| lowestPrice | 0.005 | 0.009 | 170962.089 |
| mostJobs | 0.005 | 0.006 | 192798.606 |
| fastestResponse | 0.005 | 0.009 | 185471.705 |

- Repository returns the candidate set; the service ranks/limits it (distance ranking uses the haversine helper).
- The JSONB `categories @> ` containment path is backed by idx_providers_categories_gin.

## Phase 4 — Marketplace workload simulation

Repository latency behind realistic actions (driver: postgres).

### Per-flow latency (DB portion)

| Flow | p50 (ms) | p95 (ms) | p99 (ms) | flows/s |
| --- | --- | --- | --- | --- |
| customer: discover (category+rank) | 0.822 | 1.219 | 1.265 | 1073.312 |
| customer: provider profile + reviews | 0.441 | 0.542 | 0.633 | 2207.533 |
| customer: create booking (+notify) | 2.108 | 2.483 | 2.663 | 463.375 |
| provider: dashboard | 0.548 | 0.712 | 0.909 | 1758.274 |
| provider: unread badge | 0.208 | 0.293 | 0.349 | 4505.007 |
| admin: dashboard stats | 3.436 | 3.741 | 3.928 | 288.145 |

- Admin "dashboard stats" runs 5 aggregate queries; latency shown is for the whole bundle.
- These are the same repository methods the controllers call — no business logic was duplicated.

## Phase 11 — Payment performance & correctness

PaymentService benchmarked and validated through its public API; the payment module is unchanged.

### Payment operation latency

| Operation | p50 (ms) | p95 (ms) | ops/s |
| --- | --- | --- | --- |
| createPayment | 2.285 | 2.644 | 433.107 |
| getByReference | 0.243 | 0.341 | 3932.91 |
| webhook settle | 1.499 | 1.768 | 633.505 |
| listForCustomer | 0.401 | 0.52 | 2403.216 |

- Transaction store in use: PgTransactionRepository.
- Sequential idempotency: PASS — after 10 replays the transaction is succeeded with exactly 1 settlement event(s).
- Parallel retries (25 simultaneous identical webhooks, 0 errors=true): final status succeeded, 1 settlement event(s) recorded.
- How concurrency resolves: each parallel webhook handler reads its own snapshot, applies the settlement and saves; the JSONB store is last-write-wins, so the persisted document ends with a single succeeded transition and the correct terminal status/amount — the financial outcome is correct. This is NOT row-level serialization, so if a future change makes the webhook take an external side effect per call (e.g. a payout API), harden it WITHOUT touching the payment module via a conditional settlement at the repository layer (`UPDATE ... WHERE status NOT IN (terminal)`) or `SELECT ... FOR UPDATE` inside a transaction.

## Phase 5 — Concurrent load + Phase 9 — Connection pool

Mixed read/write workload (≈80/20) at increasing concurrency, then a pool-size sweep.

### Concurrency sweep (levels: 50, 100, 250, 500)

| Concurrency | ops/s | p50 (ms) | p95 (ms) | p99 (ms) | max (ms) | error rate |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | 3859.771 | 12.978 | 18.55 | 21.299 | 26.015 | 0 |
| 100 | 5020.46 | 18.883 | 26.722 | 28.464 | 30.748 | 0 |
| 250 | 5407.644 | 45.679 | 50.323 | 51.805 | 54.817 | 0 |
| 500 | 5140.503 | 94.635 | 106.459 | 108.641 | 110.389 | 0 |

### Connection-pool sweep (SELECT workload, concurrency 64)

| pool max | ops/s | p50 (ms) | p95 (ms) | p99 (ms) | error rate |
| --- | --- | --- | --- | --- | --- |
| 5 | 11102.807 | 4.985 | 7.463 | 19.441 | 0 |
| 10 | 11591.693 | 5.194 | 7.227 | 9.464 | 0 |
| 20 | 12713.959 | 4.965 | 6.877 | 10.968 | 0 |
| 40 | 12767.577 | 4.487 | 7.636 | 19.625 | 0 |

- Best p95 in this run: pool max = 20 (6.877 ms). For a single API instance, pool ≈ (cores × 2) + spare is a good production default; size the DB max_connections for (instances × pool).
- Error rate should stay 0; non-zero indicates pool exhaustion or statement timeouts under load.
- Re-run with BENCH_CONCURRENCY="100,500,1000,5000,10000" on production-class hardware for full stress numbers.

## Phase 6/7/8 — Query analysis, indexes & JSONB

EXPLAIN (ANALYZE, BUFFERS) on every representative repository query, plus storage and index-usage stats.

### Query plans (ANALYZE-fresh stats; index path validated with enable_seqscan=off)

| Query | Exec (ms) | Access | Index path | Sort |
| --- | --- | --- | --- | --- |
| provider: category + JSONB containment | 0.592 | Seq Scan (providers, 500 rows) | idx_providers_category, idx_providers_categories_gin (validated) | — |
| provider: verified + available + rating | 0.195 | Seq Scan (providers, 500 rows) | idx_providers_availability (validated) | — |
| booking: list by customer (newest) | 0.059 | Index | idx_bookings_customer_created | quicksort |
| booking: by status (newest) | 0.158 | Index | idx_bookings_status_created | — |
| booking: count by status | 2.257 | Seq Scan (bookings, 7490 rows) | idx_bookings_status_created (validated) | — |
| transaction: sum by status | 1.753 | Seq Scan (transactions, 4111 rows) | idx_transactions_status_created (validated) | — |
| transaction: list by customer (newest) | 0.033 | Index | idx_transactions_customer_created | quicksort |
| review: list by provider (newest) | 0.029 | Index | idx_reviews_provider_created | quicksort |
| notification: unread count (partial idx) | 0.03 | Index | idx_notifications_unread | — |
| notification: list by user (newest) | 0.032 | Index | idx_notifications_user_created | quicksort |
| message: conversation history | 0.025 | Index | idx_messages_conversation_created | quicksort |
| audit: by action (newest) | 0.087 | Index | idx_audit_action_created | — |

### Table & index storage

| Table | Rows | Total (MB) | Index (MB) |
| --- | --- | --- | --- |
| bookings | 7490 | 5.22 | 1.49 |
| transactions | 4111 | 3.26 | 0.75 |
| notifications | 5351 | 2.2 | 0.73 |
| messages | 3787 | 1.58 | 0.55 |
| reviews | 1501 | 0.87 | 0.37 |
| providers | 500 | 0.77 | 0.2 |
| users | 1002 | 0.53 | 0.17 |
| favourites | 1242 | 0.51 | 0.23 |
| conversations | 750 | 0.49 | 0.22 |
| saved_addresses | 981 | 0.41 | 0.13 |
| audit_logs | 1002 | 0.38 | 0.16 |
| availabilities | 500 | 0.2 | 0.05 |
| refresh_tokens | 0 | 0.03 | 0.02 |
| device_tokens | 0 | 0.02 | 0.02 |
| notification_preferences | 0 | 0.02 | 0.01 |

- No hot-path query needs a new index. Sequential scans that appear above are on small tables where the planner correctly prefers a scan; the "Index used" column confirms an index path is available and takes over as the table grows (validated with enable_seqscan=off).
- JSONB strategy: filter/sort keys (status, customer_id, category, created_at, rating, price) are promoted to indexed columns; the full document stays in `doc` for flexibility. Multi-value `categories` uses a GIN index.
- Indexes with zero scans this run (re-evaluate if also unused in production): idx_audit_action_created, idx_audit_actor, idx_bookings_customer_created, conversations_booking_reference_key, idx_conversations_customer, idx_conversations_provider, idx_device_user, favourites_customer_id_provider_id_key, idx_favourites_customer, idx_messages_conversation, idx_messages_conversation_created, idx_providers_availability, idx_providers_categories_gin, idx_providers_category, idx_providers_rating, idx_providers_starting_price, idx_refresh_hash, idx_refresh_user, idx_reviews_customer, idx_reviews_status, reviews_booking_reference_key, idx_addresses_customer, idx_transactions_status_created, idx_users_role, users_email_key.

## Phase 14 — Operational readiness

Backup/restore/maintenance timings and autovacuum configuration.

### Maintenance operation timings

| Operation | ms |
| --- | --- |
| ANALYZE (whole DB) | 233.1 |
| VACUUM (ANALYZE) | 256.7 |
| pg_dump (custom) → 1.2 MB | 302.5 |
| pg_restore (scratch DB) | 679.4 |

### Relevant settings

| Setting | Value |
| --- | --- |
| autovacuum | on |
| autovacuum_analyze_scale_factor | 0.1 |
| autovacuum_vacuum_scale_factor | 0.2 |
| checkpoint_timeout | 300 s |
| maintenance_work_mem | 65536 kB |
| wal_level | replica |

- Recommended schedule: rely on autovacuum (on by default); add a nightly `pg_dump --format=custom` (see deploy/backup.sh) + managed snapshots; run `ANALYZE` after bulk loads; `REINDEX CONCURRENTLY` only if index bloat is observed.
- Replication readiness: `wal_level=replica` (or higher) enables streaming replicas / PITR — confirm before go-live.
