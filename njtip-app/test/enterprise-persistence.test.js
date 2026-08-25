'use strict';
// v1.3 enterprise persistence semantics: optimistic locking (compare-and-swap),
// transactions (all-or-nothing with rollback), and a bounded connection pool with
// backpressure — all behind the SAME store/driver ports (business logic unchanged).
const { test } = require('node:test');
const assert = require('node:assert');
const { MemorySqlDriver } = require('../src/adapters/drivers/sql-driver');
const { SqlStore } = require('../src/adapters/sql-store');
const { UnitOfWork } = require('../src/adapters/uow');
const { ConnectionPool } = require('../src/adapters/pool');

test('optimistic locking prevents lost updates (compare-and-swap)', () => {
  const d = new MemorySqlDriver();
  const s = new SqlStore('independent', 'reports', d);
  s.put('K', { n: 0 });
  const a = s.getWithVersion('K'); // both readers see the same version
  const b = s.getWithVersion('K');
  assert.strictEqual(a.version, b.version);
  // First writer wins.
  const w1 = s.putIfVersion('K', { n: 1 }, a.version);
  assert.strictEqual(w1.ok, true);
  // Second writer, holding a stale version, is rejected (conflict) — no lost update.
  const w2 = s.putIfVersion('K', { n: 2 }, b.version);
  assert.strictEqual(w2.ok, false);
  assert.strictEqual(w2.conflict, true);
  assert.deepStrictEqual(s.get('K'), { n: 1 });
  // Retrying with the fresh version succeeds.
  const fresh = s.getWithVersion('K');
  assert.strictEqual(s.putIfVersion('K', { n: 2 }, fresh.version).ok, true);
  assert.deepStrictEqual(s.get('K'), { n: 2 });
});

test('transactions are all-or-nothing (rollback restores the snapshot)', () => {
  const d = new MemorySqlDriver();
  const reports = new SqlStore('independent', 'reports', d);
  const notes = new SqlStore('independent', 'notifications', d);
  reports.put('K', { status: 'received' });
  const uow = new UnitOfWork(d);
  assert.ok(uow.supported());
  // A failing multi-step operation must leave NOTHING behind.
  assert.throws(() => uow.run(() => {
    reports.put('K', { status: 'reviewed' });
    notes.put('K', [{ t: 'x' }]);
    throw new Error('boom halfway');
  }), /boom/);
  assert.deepStrictEqual(reports.get('K'), { status: 'received' }); // rolled back
  assert.strictEqual(notes.get('K'), null);                          // rolled back
  // A successful transaction commits both writes.
  uow.run(() => { reports.put('K', { status: 'reviewed' }); notes.put('K', [{ t: 'ok' }]); });
  assert.deepStrictEqual(reports.get('K'), { status: 'reviewed' });
  assert.deepStrictEqual(notes.get('K'), [{ t: 'ok' }]);
});

test('connection pool enforces the concurrency ceiling with FIFO backpressure', async () => {
  let created = 0;
  const pool = new ConnectionPool(() => ({ id: ++created }), { max: 2 });
  const order = [];
  const hold = (label, ms) => pool.withConnection(async () => {
    order.push('start:' + label);
    await new Promise((r) => setTimeout(r, ms));
    order.push('end:' + label);
  });
  // 3 concurrent users, pool of 2 → the third must wait for a release.
  await Promise.all([hold('a', 20), hold('b', 20), hold('c', 5)]);
  assert.ok(pool.stats().created <= 2, 'never exceeds max connections');
  assert.ok(pool.stats().waited >= 1, 'at least one request experienced backpressure');
  // c starts only after one of a/b ends.
  assert.ok(order.indexOf('start:c') > Math.min(order.indexOf('end:a'), order.indexOf('end:b')));
});
