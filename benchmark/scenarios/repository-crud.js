'use strict';

const { measure } = require('../lib/stats');

/**
 * Phase 3 — Repository performance benchmarks.
 *
 * Exercises the core CRUD + list operations through the repository interface
 * (the exact methods services call) for every available driver, then builds a
 * side-by-side comparison. The notification domain is used because its shape is
 * simple and every driver implements the same method set
 * (create/findById/save/listByUser/countUnread + delete via repo internals).
 */
async function run(ctx) {
  const { drivers, config } = ctx;
  const samples = Math.min(config.samples, 3000);
  const ops = ['create', 'readById', 'update', 'listByUser', 'countUnread'];

  // results[op][driverName] = stat
  const results = {};
  ops.forEach((o) => {
    results[o] = {};
  });

  for (const driver of drivers) {
    const repo = driver.repos.notification;
    const userId = 'bench-crud-user';
    const ids = [];

    // CREATE
    let i = 0;
    results.create[driver.name] = await measure(`${driver.name}.create`, async () => {
      const id = `bench-ntf-${driver.name}-${i}`;
      ids.push(id);
      i += 1;
      return repo.create({
        id,
        userId,
        type: 'announcement',
        title: 'Bench',
        body: 'benchmark notification',
        read: false,
        createdAt: new Date(),
      });
    }, { samples });

    // READ by id
    let r = 0;
    results.readById[driver.name] = await measure(`${driver.name}.readById`, async () => {
      const id = ids[r % ids.length];
      r += 1;
      return repo.findById(id);
    }, { samples });

    // UPDATE (mark read via save)
    let u = 0;
    results.update[driver.name] = await measure(`${driver.name}.update`, async () => {
      const id = ids[u % ids.length];
      u += 1;
      const doc = await repo.findById(id);
      doc.read = true;
      doc.updatedAt = new Date();
      return repo.save(doc);
    }, { samples: Math.min(samples, 1000) });

    // LIST by user (newest-first, capped) — a hot read path
    results.listByUser[driver.name] = await measure(`${driver.name}.listByUser`, async () =>
      repo.listByUser(userId, { limit: 20 }), { samples: Math.min(samples, 1000) });

    // COUNT unread
    results.countUnread[driver.name] = await measure(`${driver.name}.countUnread`, async () =>
      repo.countUnread(userId), { samples: Math.min(samples, 1000) });
  }

  const driverNames = drivers.map((d) => d.name);
  const columns = ['Operation', ...driverNames.flatMap((n) => [`${n} p50 (ms)`, `${n} p95 (ms)`, `${n} ops/s`])];
  const rows = ops.map((op) => {
    const row = [op];
    for (const n of driverNames) {
      const s = results[op][n];
      row.push(s ? s.p50 : '', s ? s.p95 : '', s ? s.throughput : '');
    }
    return row;
  });

  return {
    title: 'Phase 3 — Repository CRUD performance',
    description:
      'Per-operation latency and throughput through the repository interface (notification domain). ' +
      'In-memory is the theoretical ceiling; PostgreSQL includes real network + durability cost.',
    tables: [{ title: `Comparison across drivers (${samples} samples)`, columns, rows }],
    notes: [
      'All drivers expose the identical method set — the repository abstraction is unchanged.',
      'p50/p95 in milliseconds; ops/s is sustained sequential throughput.',
    ],
    raw: results,
  };
}

module.exports = { run };
