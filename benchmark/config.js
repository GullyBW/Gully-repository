'use strict';

/**
 * Benchmark configuration. All knobs are env-overridable so runs are
 * reproducible in CI and on a workstation without editing code.
 *
 * Dataset sizes mirror the brief (Phase 2). Counts are *target* volumes; the
 * generator derives reviews/messages/notifications/etc. from these.
 */
const SIZES = {
  small: { users: 1000, providers: 500, bookings: 5000 },
  medium: { users: 50000, providers: 10000, bookings: 250000 },
  large: { users: 500000, providers: 100000, bookings: 5000000 },
  // Tiny is used by the self-test and CI smoke run — fast and deterministic.
  tiny: { users: 200, providers: 80, bookings: 600 },
};

function resolveSize(name) {
  const key = (name || process.env.BENCH_SIZE || 'small').toLowerCase();
  if (!SIZES[key]) {
    throw new Error(`Unknown dataset size "${key}". Use one of: ${Object.keys(SIZES).join(', ')}`);
  }
  return { name: key, ...SIZES[key] };
}

module.exports = {
  SIZES,
  resolveSize,

  // Connection used by the benchmark. Defaults to the project's local PG.
  postgresUrl:
    process.env.BENCH_DATABASE_URL ||
    process.env.DATABASE_URL ||
    'postgresql://postgres@127.0.0.1:5432/tirelo',

  // Optional Mongo comparison; skipped unless reachable.
  mongoUrl: process.env.BENCH_MONGODB_URI || process.env.MONGODB_URI || '',

  // Deterministic seed so datasets are reproducible across runs/machines.
  seed: parseInt(process.env.BENCH_SEED || '1337', 10),

  // Per-operation sample counts for the micro-benchmarks (Phase 3/12).
  samples: parseInt(process.env.BENCH_SAMPLES || '2000', 10),

  // Concurrency levels for the load test (Phase 5). Capped for the default run;
  // override with BENCH_CONCURRENCY="100,500,1000,5000,10000".
  concurrency: (process.env.BENCH_CONCURRENCY || '50,100,250,500')
    .split(',')
    .map((n) => parseInt(n.trim(), 10))
    .filter(Boolean),

  // Connection-pool sizes to sweep (Phase 9).
  poolSizes: (process.env.BENCH_POOL_SIZES || '5,10,20,40')
    .split(',')
    .map((n) => parseInt(n.trim(), 10))
    .filter(Boolean),

  reportsDir: require('path').join(__dirname, 'reports'),
  datasetsDir: require('path').join(__dirname, 'datasets'),
};
