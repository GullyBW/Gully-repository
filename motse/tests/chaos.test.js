'use strict';

/**
 * Reliability engineering — fault injection through the ChaosKv wrapper.
 * Two layers verified here:
 *
 *   1. The wrapper itself: same Redis-shaped interface, outage / transient /
 *      latency / restart fault modes, faithful plain-Error failures.
 *   2. The REAL distributed services under injected faults: how idempotency,
 *      rate limiting and locks behave during an outage, across transient
 *      blips, and after a Redis restart with data loss — including the
 *      documented recovery semantics.
 */
const { ChaosKv } = require('../src/distributed/chaos.kv');
const { InMemoryKvAdapter } = require('../src/distributed/kv');
const {
  DistributedIdempotency,
  DistributedRateLimiter,
  DistributedLock,
} = require('../src/distributed/services');
const { Metrics } = require('../src/monitoring/metrics');
const { Clock } = require('../src/kernel/clock');

function chaos(opts) {
  return new ChaosKv(new InMemoryKvAdapter({ clock: new Clock() }), opts);
}

describe('ChaosKv — interface passthrough', () => {
  test('healthy wrapper is behaviourally identical to the inner adapter', async () => {
    const kv = chaos();
    expect(await kv.setNx('a', '1', 1000)).toBe(true);
    expect(await kv.setNx('a', '2', 1000)).toBe(false);
    expect(await kv.get('a')).toBe('1');
    expect(await kv.set('b', 'x')).toBe('OK');
    expect(await kv.incrBy('n', 2, 1000)).toBe(2);
    expect(await kv.incrBy('n', 3)).toBe(5);
    expect(await kv.pttl('a')).toBeGreaterThan(0);
    expect(await kv.pttl('missing')).toBe(-2);
    expect(await kv.del('a')).toBe(1);
    expect(await kv.get('a')).toBeNull();
    expect(kv.stats()).toMatchObject({ faults: 0, down: false });
    expect(kv.stats().calls).toBeGreaterThan(0);
  });

  test('down() fails every call with a plain (non-Motse) error; up() restores', async () => {
    const kv = chaos();
    kv.down();
    await expect(kv.get('k')).rejects.toThrow('chaos: down');
    await expect(kv.setNx('k', '1')).rejects.toThrow('chaos: down');
    const e = await kv.incrBy('k').catch((x) => x);
    expect(e.code).toBeUndefined(); // infra failure, not a MotseError
    expect(kv.stats()).toMatchObject({ down: true, faults: 3 });
    kv.up();
    expect(await kv.setNx('k', '1')).toBe(true);
  });

  test('failNext(n) injects exactly n transient failures then recovers', async () => {
    const kv = chaos();
    kv.failNext(2);
    await expect(kv.get('k')).rejects.toThrow('chaos: transient');
    await expect(kv.get('k')).rejects.toThrow('chaos: transient');
    expect(await kv.get('k')).toBeNull(); // budget exhausted → healthy
    expect(kv.faults).toBe(2);
  });

  test('withLatency(ms) delays calls (network degradation)', async () => {
    const kv = chaos().withLatency(5);
    const t0 = Date.now();
    await kv.set('k', 'v');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4);
  });

  test('restart() swaps in a fresh adapter — previous state is lost', async () => {
    const kv = chaos();
    await kv.set('persist', 'me');
    kv.down();
    const old = kv.restart(new InMemoryKvAdapter({ clock: new Clock() }));
    expect(old).toBeTruthy();
    expect(kv.stats().down).toBe(false); // restart implies back up
    expect(await kv.get('persist')).toBeNull(); // unpersisted Redis came back empty
  });
});

describe('Distributed services under injected faults', () => {
  test('idempotency: an outage surfaces the infra error and the operation is retryable after recovery', async () => {
    const kv = chaos();
    const metrics = new Metrics();
    const idem = new DistributedIdempotency({ kv, metrics });
    kv.down();
    let ran = 0;
    await expect(idem.runOnce('op-1', () => { ran += 1; return 'x'; })).rejects.toThrow('chaos: down');
    expect(ran).toBe(0); // fn never executed during the outage — fail-closed
    kv.up();
    const after = await idem.runOnce('op-1', () => { ran += 1; return 'x'; });
    expect(after).toEqual({ ran: true, result: 'x' });
    expect(ran).toBe(1); // exactly once overall
  });

  test('idempotency: restart with data loss re-allows execution (documented at-least-once boundary)', async () => {
    const kv = chaos();
    const idem = new DistributedIdempotency({ kv });
    await idem.runOnce('op-2', () => 'first');
    expect(await idem.runOnce('op-2', () => 'again')).toEqual({ ran: false });
    // Redis restarts unpersisted → reservations lost → the guard degrades to
    // at-least-once. This is the expected boundary; consumers stay idempotent.
    kv.restart(new InMemoryKvAdapter({ clock: new Clock() }));
    const rerun = await idem.runOnce('op-2', () => 'again');
    expect(rerun).toEqual({ ran: true, result: 'again' });
  });

  test('rate limiter: outage fails closed (throws) rather than silently allowing unlimited traffic', async () => {
    const kv = chaos();
    const rl = new DistributedRateLimiter({ kv, clock: new Clock(), capacity: 2, windowMs: 60000 });
    expect((await rl.take('u1')).allowed).toBe(true);
    kv.down();
    await expect(rl.take('u1')).rejects.toThrow('chaos: down');
    kv.up();
    expect((await rl.take('u1')).allowed).toBe(true);
    expect((await rl.take('u1')).allowed).toBe(false); // window state survived the blip
  });

  test('lock: held locks are lost on restart — the fencing token prevents a silent double-release', async () => {
    const kv = chaos();
    const lock = new DistributedLock({ kv });
    expect(await lock.acquire('res', 'token-A', 60000)).toBe(true);
    kv.restart(new InMemoryKvAdapter({ clock: new Clock() }));
    // After data loss another worker can acquire — mutual exclusion is TTL/
    // fencing-bounded, not absolute. The original holder's release is a no-op
    // (token mismatch on the new holder's lock), never a steal.
    expect(await lock.acquire('res', 'token-B', 60000)).toBe(true);
    expect(await lock.release('res', 'token-A')).toBe(false);
    expect(await lock.release('res', 'token-B')).toBe(true);
  });

  test('lock: a transient failure during release leaves the lock to TTL expiry (no deadlock beyond TTL)', async () => {
    const clock = new Clock();
    const inner = new InMemoryKvAdapter({ clock });
    const kv = new ChaosKv(inner);
    const lock = new DistributedLock({ kv, ttlMs: 50 });
    // withLock: acquire OK, fn OK, then the release's get() hits a blip.
    await expect(
      lock.withLock('res2', async () => {
        kv.failNext(1);
        return 'done';
      })
    ).rejects.toThrow('chaos: transient');
    // The lock row still exists until TTL — then the resource frees itself.
    await new Promise((r) => { setTimeout(r, 60); });
    expect(await lock.acquire('res2', 'next', 1000)).toBe(true);
  });
});
