'use strict';

const { measureConcurrent } = require('../lib/stats');
const pg = require('../lib/pg-admin');

/**
 * Phase 5 — Concurrent load testing + Phase 9 connection-pool sweep.
 *
 * Drives a mixed read/write workload against PostgreSQL at increasing
 * concurrency levels through the repository layer, capturing latency
 * percentiles, throughput, error rate and pool utilisation. Then sweeps pool
 * sizes on a read workload to recommend a production default.
 *
 * Concurrency levels and pool sizes are configurable; the committed default
 * uses a modest range so the suite runs quickly and deterministically in CI.
 * Override with BENCH_CONCURRENCY / BENCH_POOL_SIZES for capacity testing.
 */
async function run(ctx) {
  const { drivers, dataset, config } = ctx;
  const driver = drivers.find((d) => d.name === 'postgres');
  if (!driver) {
    return { title: 'Phase 5 — Concurrent load testing', notes: ['Skipped: requires PostgreSQL.'] };
  }
  const repos = driver.repos;
  const { customerIds, providerIds } = dataset.sample;
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Mixed op: ~80% reads, ~20% writes — representative of a marketplace.
  let writeSeq = 0;
  async function mixedOp() {
    const roll = Math.random();
    if (roll < 0.4) return repos.provider.query({ category: pick(dataset.sample.categories), availableOnly: true });
    if (roll < 0.65) return repos.booking.listByProvider(pick(providerIds), { limit: 20 });
    if (roll < 0.8) return repos.notification.countUnread(pick(customerIds));
    // write
    const id = `cc-${process.pid}-${writeSeq}`;
    writeSeq += 1;
    return repos.booking.create({
      reference: `BKG-CC-${id}`, customerId: pick(customerIds), providerId: pick(providerIds),
      serviceType: 'cleaner', amount: 30000, currency: 'BWP', status: 'pending',
      createdAt: new Date(), updatedAt: new Date(),
    });
  }

  const concRows = [];
  for (const level of config.concurrency) {
    // eslint-disable-next-line no-await-in-loop
    const stat = await measureConcurrent(`c=${level}`, mixedOp, { total: Math.max(level * 8, 1000), concurrency: level });
    concRows.push([level, stat.throughput, stat.p50, stat.p95, stat.p99, stat.max, stat.errorRate]);
  }

  // Phase 9 — pool size sweep on a read workload.
  const poolRows = [];
  for (const max of config.poolSizes) {
    // eslint-disable-next-line no-await-in-loop
    const stat = await pg.timePoolConfig({ max, total: 3000, concurrency: 64 });
    poolRows.push([max, stat.throughput, stat.p50, stat.p95, stat.p99, stat.errorRate]);
  }

  // Recommend the pool size with the best p95 at saturation.
  const best = poolRows.reduce((a, b) => (b[3] < a[3] ? b : a), poolRows[0]);

  return {
    title: 'Phase 5 — Concurrent load + Phase 9 — Connection pool',
    description: 'Mixed read/write workload (≈80/20) at increasing concurrency, then a pool-size sweep.',
    tables: [
      {
        title: `Concurrency sweep (levels: ${config.concurrency.join(', ')})`,
        columns: ['Concurrency', 'ops/s', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)', 'max (ms)', 'error rate'],
        rows: concRows,
      },
      {
        title: 'Connection-pool sweep (SELECT workload, concurrency 64)',
        columns: ['pool max', 'ops/s', 'p50 (ms)', 'p95 (ms)', 'p99 (ms)', 'error rate'],
        rows: poolRows,
      },
    ],
    notes: [
      `Best p95 in this run: pool max = ${best[0]} (${best[3]} ms). For a single API instance, pool ≈ (cores × 2) + spare ` +
        'is a good production default; size the DB max_connections for (instances × pool).',
      'Error rate should stay 0; non-zero indicates pool exhaustion or statement timeouts under load.',
      'Re-run with BENCH_CONCURRENCY="100,500,1000,5000,10000" on production-class hardware for full stress numbers.',
    ],
    raw: { concRows, poolRows },
  };
}

module.exports = { run };
