'use strict';

/**
 * Foundation F3 — the Redis-ready distributed runtime. A KV abstraction
 * (in-memory today, Redis in production) underpins cross-pod idempotency,
 * a shared rate limiter and distributed locks. The in-memory adapter keeps
 * single-process behaviour identical; the Redis adapter is exercised here
 * against a faithful fake client.
 */
const { Clock } = require('../src/kernel/clock');
const { InMemoryKvAdapter, RedisKvAdapter, createKv } = require('../src/distributed/kv');
const { DistributedIdempotency, DistributedRateLimiter, DistributedLock } = require('../src/distributed/services');

/** A minimal Redis fake covering exactly the commands the adapter issues. */
class FakeRedis {
  constructor() { this.map = new Map(); this.calls = []; }
  async get(k) { this.calls.push(['get', k]); const e = this.map.get(k); return e === undefined ? null : String(e); }
  async set(k, v, ...opts) {
    this.calls.push(['set', k, v, ...opts]);
    const nx = opts.includes('NX');
    if (nx && this.map.has(k)) return null;
    this.map.set(k, v);
    return 'OK';
  }
  async incrby(k, n) { this.calls.push(['incrby', k, n]); const v = (Number(this.map.get(k)) || 0) + n; this.map.set(k, v); return v; }
  async pexpire(k, ms) { this.calls.push(['pexpire', k, ms]); return 1; }
  async del(k) { this.calls.push(['del', k]); return this.map.delete(k) ? 1 : 0; }
  async pttl(k) { this.calls.push(['pttl', k]); return this.map.has(k) ? 1000 : -2; }
}

async function expectRejects(promise, code) {
  let e;
  try { await promise; } catch (caught) { e = caught; }
  expect(e).toBeDefined();
  if (code) expect(e.code).toBe(code);
}

describe('KV abstraction', () => {
  test('in-memory adapter: get/set/setNx/incrBy/del + TTL expiry', async () => {
    const clock = new Clock();
    const kv = new InMemoryKvAdapter({ clock });
    expect(await kv.get('x')).toBeNull();
    await kv.set('x', 'v', 1000);
    expect(await kv.get('x')).toBe('v');
    expect(await kv.setNx('x', 'other')).toBe(false); // exists
    expect(await kv.setNx('y', 'yes', 500)).toBe(true);
    expect(await kv.incrBy('c', 2, 1000)).toBe(2);
    expect(await kv.incrBy('c', 3)).toBe(5);
    expect(await kv.pttl('x')).toBeGreaterThan(0);
    expect(await kv.pttl('missing')).toBe(-2);
    await kv.set('perm', '1'); // no TTL
    expect(await kv.pttl('perm')).toBe(-1);
    expect(await kv.del('x')).toBe(1);
    // TTL expiry.
    clock.advance(1200);
    expect(await kv.get('y')).toBeNull();
  });

  test('redis adapter maps onto a client; first incr sets the TTL', async () => {
    const client = new FakeRedis();
    const kv = new RedisKvAdapter({ client });
    await kv.set('a', 'v', 1000);
    expect(await kv.get('a')).toBe('v');
    expect(await kv.setNx('a', 'no')).toBe(false);
    expect(await kv.setNx('b', 'yes', 200)).toBe(true);
    expect(await kv.incrBy('n', 1, 1000)).toBe(1); // first write → pexpire
    expect(await kv.incrBy('n', 1, 1000)).toBe(2); // no new TTL
    expect(client.calls.filter((c) => c[0] === 'pexpire')).toHaveLength(1);
    expect(await kv.del('a')).toBe(1);
    expect(await kv.pttl('b')).toBe(1000);
  });

  test('createKv selects the adapter from configuration', () => {
    // Default → in-memory (no REDIS_URL). An injected client → Redis. We do
    // NOT exercise the real-connection path here (it would open a socket).
    expect(createKv().constructor.name).toBe('InMemoryKvAdapter'); // no args → defaults
    expect(createKv({ clock: new Clock() }).constructor.name).toBe('InMemoryKvAdapter');
    expect(createKv({ client: new FakeRedis() }).constructor.name).toBe('RedisKvAdapter');
    // The redisUrl path via an injected factory (no real socket opened).
    const viaFactory = createKv({ redisUrl: 'redis://x', redisFactory: () => new FakeRedis() });
    expect(viaFactory.constructor.name).toBe('RedisKvAdapter');
    expect(() => new RedisKvAdapter({})).toThrow(); // client is required
  });

  test('adapters and services apply their default options', async () => {
    const kv = new InMemoryKvAdapter(); // no clock → Date.now fallback
    expect(await kv.setNx('k', 'v')).toBe(true); // no ttl → no expiry
    expect(await kv.incrBy('c')).toBe(1); // default n=1, no ttl
    // Services with all defaults.
    const idem = new DistributedIdempotency({ kv });
    expect(idem.ttlMs).toBeGreaterThan(0);
    const rl = new DistributedRateLimiter({ kv }); // default clock/capacity/window
    expect((await rl.take('u')).limit).toBe(300);
    const lock = new DistributedLock({ kv }); // default ttl
    expect(await lock.acquire('n', 't')).toBe(true);
    // Construct each with NO args at all (the `= {}` default parameter).
    expect(new DistributedIdempotency().ttlMs).toBeGreaterThan(0);
    expect(new DistributedRateLimiter().capacity).toBe(300);
    expect(new DistributedLock().ttlMs).toBeGreaterThan(0);
    // Redis adapter, no-TTL variants of each write.
    const rkv = new RedisKvAdapter({ client: new FakeRedis() });
    expect(await rkv.set('x', '1')).toBe('OK'); // no ttl
    expect(await rkv.setNx('y', '1')).toBe(true); // no ttl
    expect(await rkv.incrBy('z', 2)).toBe(2); // no ttl
  });
});

describe('Distributed idempotency (cross-pod exactly-once)', () => {
  test('runOnce executes once per key; a second caller is a no-op', async () => {
    const idem = new DistributedIdempotency({ kv: new InMemoryKvAdapter() });
    let runs = 0;
    const first = await idem.runOnce('k1', async () => { runs += 1; return 'done'; });
    const second = await idem.runOnce('k1', async () => { runs += 1; return 'done'; });
    expect(first).toEqual({ ran: true, result: 'done' });
    expect(second).toEqual({ ran: false });
    expect(runs).toBe(1);
    expect(await idem.seen('k1')).toBe(true);
  });

  test('a failing operation releases its reservation so it can retry', async () => {
    const idem = new DistributedIdempotency({ kv: new InMemoryKvAdapter() });
    await expectRejects(idem.runOnce('k2', async () => { throw new Error('boom'); }));
    // Reservation released → a retry may proceed.
    const retry = await idem.runOnce('k2', async () => 'ok');
    expect(retry).toEqual({ ran: true, result: 'ok' });
  });

  test('concurrent callers with the same key → exactly one executes', async () => {
    const idem = new DistributedIdempotency({ kv: new InMemoryKvAdapter() });
    let runs = 0;
    const results = await Promise.all(
      Array.from({ length: 25 }, () => idem.runOnce('shared', async () => { runs += 1; return 1; }))
    );
    expect(results.filter((r) => r.ran)).toHaveLength(1);
    expect(runs).toBe(1);
  });
});

describe('Distributed rate limiter (shared window)', () => {
  test('enforces a global limit and reports remaining', async () => {
    const kv = new InMemoryKvAdapter({ clock: new Clock() });
    const rl = new DistributedRateLimiter({ kv, clock: new Clock(), capacity: 5, windowMs: 60000 });
    const outcomes = [];
    for (let i = 0; i < 8; i += 1) outcomes.push(await rl.take('user:1'));
    expect(outcomes.filter((o) => o.allowed)).toHaveLength(5);
    expect(outcomes[0]).toMatchObject({ allowed: true, limit: 5 });
    expect(outcomes[7].allowed).toBe(false);
    expect(outcomes[7].remaining).toBe(0);
  });

  test('the window resets over time; concurrent takes share one counter', async () => {
    const clock = new Clock();
    const rl = new DistributedRateLimiter({ kv: new InMemoryKvAdapter({ clock }), clock, capacity: 3, windowMs: 1000 });
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => rl.take('u')));
    expect(concurrent.filter((o) => o.allowed)).toHaveLength(3); // ONE shared counter
    clock.advance(1001); // next window
    expect((await rl.take('u')).allowed).toBe(true);
  });
});

describe('Distributed lock', () => {
  test('mutual exclusion, ownership-checked release, and withLock', async () => {
    const lock = new DistributedLock({ kv: new InMemoryKvAdapter() });
    expect(await lock.acquire('r', 'tok1')).toBe(true);
    expect(await lock.acquire('r', 'tok2')).toBe(false); // held
    expect(await lock.release('r', 'wrong')).toBe(false); // never steal
    expect(await lock.release('r', 'tok1')).toBe(true);

    let ran = false;
    await lock.withLock('r2', async () => { ran = true; });
    expect(ran).toBe(true); // released afterwards
    expect(await lock.acquire('r2', 'again')).toBe(true);

    await lock.acquire('r3', 'held');
    await expectRejects(lock.withLock('r3', async () => {}), 'STATE_CONFLICT');
  });
});
