'use strict';

/**
 * Missions 8 (resilience) + 5 (runtime intelligence). Circuit breakers,
 * bulkheads, adaptive retry + budgets, timeout deadlines, load shedding,
 * self-healing, and Node runtime telemetry with predictive insights — each
 * validated in isolation and, for the chaos-critical paths, against the
 * ChaosKv fault injector.
 */
const { CircuitBreaker } = require('../src/resilience/circuit.breaker');
const { Bulkhead } = require('../src/resilience/bulkhead');
const { LoadShedder } = require('../src/resilience/load.shed');
const { SelfHealer } = require('../src/resilience/self.healing');
const { withRetry, withDeadline, RetryBudget, defaultClassify } = require('../src/resilience/retry');
const { Resilience } = require('../src/resilience');
const { RuntimeIntelligence, leastSquaresSlope } = require('../src/observability/runtime.intelligence');
const { DependencyHealthEngine } = require('../src/observability/dependency.health');
const { ChaosKv } = require('../src/distributed/chaos.kv');
const { InMemoryKvAdapter } = require('../src/distributed/kv');
const { DistributedIdempotency } = require('../src/distributed/services');
const { Metrics } = require('../src/monitoring/metrics');
const { MotseError } = require('../src/kernel/errors');

// Deterministic clock with advanceable time.
function fakeClock(start = 0) {
  let t = start;
  return { nowMs: () => t, nowIso: () => new Date(t).toISOString(), advance: (ms) => { t += ms; } };
}

describe('M8 · CircuitBreaker', () => {
  test('opens after the failure threshold within the rolling window', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker({ clock, failureThreshold: 3, windowMs: 1000 });
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(cb.exec(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    }
    expect(cb.state).toBe('open');
    // Now short-circuits without calling fn.
    let called = false;
    await expect(cb.exec(async () => { called = true; })).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(called).toBe(false);
    expect(cb.stats().short_circuited).toBe(1);
  });

  test('failures outside the rolling window do not count toward tripping', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker({ clock, failureThreshold: 3, windowMs: 1000 });
    await expect(cb.exec(async () => { throw new Error('e'); })).rejects.toThrow();
    clock.advance(2000); // first failure ages out
    await expect(cb.exec(async () => { throw new Error('e'); })).rejects.toThrow();
    await expect(cb.exec(async () => { throw new Error('e'); })).rejects.toThrow();
    expect(cb.state).toBe('closed'); // only 2 within the window
  });

  test('half-open probe: success closes, failure re-opens with a fresh cooldown', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker({ clock, failureThreshold: 1, cooldownMs: 100 });
    await expect(cb.exec(async () => { throw new Error('e'); })).rejects.toThrow();
    expect(cb.state).toBe('open');
    // Before cooldown → still short-circuits.
    await expect(cb.exec(async () => 'x')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    clock.advance(150);
    // A failing probe re-opens.
    await expect(cb.exec(async () => { throw new Error('again'); })).rejects.toThrow('again');
    expect(cb.state).toBe('open');
    clock.advance(150);
    // A succeeding probe closes.
    await expect(cb.exec(async () => 'ok')).resolves.toBe('ok');
    expect(cb.state).toBe('closed');
  });

  test('fallback yields graceful degradation instead of throwing', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker({ clock, failureThreshold: 1, fallback: () => 'cached-value' });
    const first = await cb.exec(async () => { throw new Error('down'); });
    expect(first).toBe('cached-value'); // failure → fallback
    const second = await cb.exec(async () => 'live'); // open → short-circuit → fallback
    expect(second).toBe('cached-value');
    expect(cb.stats().fallbacks).toBe(2);
  });

  test('reset forces the breaker closed', async () => {
    const cb = new CircuitBreaker({ clock: fakeClock(), failureThreshold: 1 });
    await expect(cb.exec(async () => { throw new Error('e'); })).rejects.toThrow();
    expect(cb.state).toBe('open');
    expect(cb.reset().state).toBe('closed');
  });

  test('emits breaker metrics', async () => {
    const metrics = new Metrics();
    const cb = new CircuitBreaker({ clock: fakeClock(), metrics, failureThreshold: 1 });
    await cb.exec(async () => 'ok');
    await expect(cb.exec(async () => { throw new Error('e'); })).rejects.toThrow();
    expect(metrics.counterValue('motse_breaker_total', { name: 'default', result: 'success' })).toBe(1);
    expect(metrics.counterValue('motse_breaker_total', { name: 'default', result: 'failure' })).toBe(1);
  });
});

describe('M8 · Bulkhead', () => {
  test('caps concurrency and queues the overflow, then admits waiters', async () => {
    const bh = new Bulkhead({ maxConcurrent: 2, maxQueue: 10 });
    let active = 0;
    let peak = 0;
    let releaseAll;
    const barrier = new Promise((r) => { releaseAll = r; });
    const runs = Array.from({ length: 5 }, () =>
      bh.exec(async () => { active += 1; peak = Math.max(peak, active); await barrier; active -= 1; return 'done'; })
    );
    await new Promise((r) => setImmediate(r));
    expect(peak).toBe(2); // never more than 2 concurrent
    expect(bh.stats().queued).toBe(3);
    releaseAll();
    await Promise.all(runs);
    expect(bh.stats().completed).toBe(5);
    expect(bh.stats().peak_active).toBe(2);
  });

  test('a throwing task is counted as failed and still frees its slot', async () => {
    const bh = new Bulkhead({ maxConcurrent: 1, maxQueue: 1 });
    await expect(bh.exec(async () => { throw new Error('work failed'); })).rejects.toThrow('work failed');
    expect(bh.stats().failed).toBe(1);
    // The slot was released, so the next call runs.
    await expect(bh.exec(async () => 'ok')).resolves.toBe('ok');
  });

  test('rejects immediately when both the pool and queue are full (no cascade)', async () => {
    const bh = new Bulkhead({ name: 'redis', maxConcurrent: 1, maxQueue: 1 });
    let releaseAll;
    const barrier = new Promise((r) => { releaseAll = r; });
    const a = bh.exec(async () => barrier); // occupies the slot
    const b = bh.exec(async () => barrier); // waits in the queue
    await new Promise((r) => setImmediate(r));
    await expect(bh.exec(async () => 'x')).rejects.toMatchObject({ code: 'UNAVAILABLE' }); // overflow
    expect(bh.stats().rejected).toBe(1);
    releaseAll();
    await Promise.all([a, b]);
  });
});

describe('M8 · adaptive retry, budgets & deadlines', () => {
  const noSleep = () => Promise.resolve();

  test('retries transient failures with backoff and eventually succeeds', async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('transient');
      return 'ok';
    }, { attempts: 5, sleep: noSleep });
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  test('classification: a non-retryable MotseError is not retried', async () => {
    let attempts = 0;
    await expect(withRetry(async () => {
      attempts += 1;
      throw new MotseError('INVALID_ARGUMENT', 'bad');
    }, { attempts: 5, sleep: noSleep })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(attempts).toBe(1); // stopped immediately
    expect(defaultClassify(new MotseError('RATE_LIMITED'))).toBe(true); // retryable ones do retry
    expect(defaultClassify(new Error('socket hang up'))).toBe(true); // infra errors retry
  });

  test('full jitter keeps backoff within [0, cap]', async () => {
    const delays = [];
    let attempts = 0;
    await expect(withRetry(async () => { attempts += 1; throw new Error('e'); }, {
      attempts: 4, baseMs: 100, maxMs: 10000, random: () => 0.5,
      sleep: (ms) => { delays.push(ms); return Promise.resolve(); },
    })).rejects.toThrow();
    // caps: 100, 200, 400 → full jitter at random=0.5 → 50, 100, 200
    expect(delays).toEqual([50, 100, 200]);
  });

  test('retry budget prevents amplification during a storm', async () => {
    const clock = fakeClock();
    const budget = new RetryBudget({ ratio: 0.5, minRetries: 1, clock });
    let retriesAllowed = 0;
    // Fire many always-failing calls sharing one budget.
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await withRetry(async () => { throw new Error('down'); }, {
        attempts: 3, budget, sleep: noSleep,
      }).catch(() => {});
    }
    // With ratio 0.5 the budget caps retries well below the 20 a naive
    // 2-retry-per-call policy would issue.
    retriesAllowed = budget.stats().recent_retries;
    expect(retriesAllowed).toBeLessThan(20);
    expect(retriesAllowed).toBeGreaterThan(0);
  });

  test('withDeadline rejects work that outlives its budget', async () => {
    const slow = new Promise((resolve) => { const t = setTimeout(() => resolve('late'), 1000); t.unref(); });
    await expect(withDeadline(slow, 20, 'slow-call')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const fast = Promise.resolve('quick');
    await expect(withDeadline(fast, 1000)).resolves.toBe('quick');
  });

  test('the default (real) sleep is used when none is injected', async () => {
    const t0 = Date.now();
    let attempts = 0;
    const out = await withRetry(async () => {
      attempts += 1;
      if (attempts < 2) throw new Error('transient');
      return 'ok';
    }, { attempts: 3, baseMs: 5, jitter: false }); // real defaultSleep, ~5ms
    expect(out).toBe('ok');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(4);
  });
});

describe('M8 · LoadShedder', () => {
  test('sheds normal traffic over the in-flight cap but never critical paths', () => {
    const shedder = new LoadShedder({ maxInFlight: 1 });
    const mw = shedder.middleware();
    const call = (path) => {
      let nextErr;
      const req = { path };
      const res = onFinish();
      mw(req, res, (e) => { nextErr = e; });
      return { nextErr, res };
    };
    const a = call('/v1/kgetsi/campaigns'); // occupies the one slot
    expect(a.nextErr).toBeUndefined();
    const b = call('/v1/kgetsi/campaigns'); // over cap → shed
    expect(b.nextErr).toMatchObject({ code: 'UNAVAILABLE' });
    const health = call('/health/live'); // critical → always passes
    expect(health.nextErr).toBeUndefined();
    const admin = call('/v1/admin/overview'); // critical → always passes
    expect(admin.nextErr).toBeUndefined();
    expect(shedder.stats().shed).toBe(1);
    expect(shedder.stats().critical_passed).toBe(2);
  });

  test('sheds on an event-loop stall signal from the lag provider', () => {
    let lag = 0;
    const shedder = new LoadShedder({ maxInFlight: 1000, lagThresholdMs: 100, lagProvider: () => lag });
    const mw = shedder.middleware();
    const req = { path: '/v1/search' };
    let err1;
    mw(req, onFinish(), (e) => { err1 = e; });
    expect(err1).toBeUndefined(); // healthy loop
    lag = 250;
    let err2;
    mw({ path: '/v1/search' }, onFinish(), (e) => { err2 = e; });
    expect(err2).toMatchObject({ code: 'UNAVAILABLE' });
  });

  test('an aborted request (close before finish) releases its in-flight slot', () => {
    const shedder = new LoadShedder({ maxInFlight: 1 });
    const mw = shedder.middleware();
    const res = onFinish();
    res.writableFinished = false; // simulate an abort
    mw({ path: '/v1/search' }, res, () => {});
    expect(shedder.inFlight).toBe(1);
    res._fire('close'); // client aborted
    expect(shedder.inFlight).toBe(0);
  });

  function onFinish() {
    const handlers = {};
    return { on: (evt, fn) => { handlers[evt] = fn; }, writableFinished: true, _fire: (e) => handlers[e] && handlers[e]() };
  }
});

describe('M8 · SelfHealer', () => {
  function engineWith(state) {
    const e = new DependencyHealthEngine({ clock: fakeClock() });
    e.summary = () => ({ ...state }); // copy: lastStates must not alias the mutable fixture
    return e;
  }

  test('runs a recovery action on the failed→healthy transition, once', async () => {
    const state = { outbox_relay: 'failed' };
    const deps = engineWith(state);
    let drained = 0;
    const healer = new SelfHealer({ dependencies: deps, clock: fakeClock() });
    healer.register('drain', { dependency: 'outbox_relay', action: async () => { drained += 1; } });
    await healer.evaluate(); // first sight — records baseline, no firing
    expect(drained).toBe(0);
    state.outbox_relay = 'healthy';
    await healer.evaluate(); // transition → heal
    expect(drained).toBe(1);
    await healer.evaluate(); // no further transition → no repeat
    expect(drained).toBe(1);
    expect(healer.stats().history[0]).toMatchObject({ action: 'drain', transition: 'failed→healthy', ok: true });
  });

  test('a throwing recovery action is recorded, never propagated', async () => {
    const state = { redis: 'failed' };
    const deps = engineWith(state);
    const logged = [];
    const healer = new SelfHealer({ dependencies: deps, logger: { info: (m, f) => logged.push([m, f]) } }); // default clock
    healer.register('boom', { dependency: 'redis', action: async () => { throw new Error('heal failed'); } });
    await healer.evaluate();
    state.redis = 'healthy';
    const ran = await healer.evaluate();
    expect(ran[0]).toMatchObject({ ok: false, error: 'heal failed' });
    expect(logged[0][0]).toBe('self-heal'); // logger path exercised
    expect(healer.stats().total_runs).toBe(1);
  });
});

describe('M8 · Resilience facade + chaos validation', () => {
  test('facade lazily creates and reuses named breakers/bulkheads/budgets', () => {
    const r = new Resilience({ clock: fakeClock(), metrics: new Metrics() });
    expect(r.breaker('redis')).toBe(r.breaker('redis'));
    expect(r.bulkhead('outbox').maxConcurrent).toBe(4); // per-compartment default
    expect(r.budget('x')).toBe(r.budget('x'));
    const s = r.stats();
    expect(s).toHaveProperty('breakers');
    expect(s).toHaveProperty('load_shedding');
  });

  test('facade constructs with no args; unknown compartment uses generic defaults; stats before healer', () => {
    const r = new Resilience(); // no clock/metrics
    const bh = r.bulkhead('unknown-compartment'); // no per-compartment default → generic
    expect(bh.maxConcurrent).toBeGreaterThan(0);
    const s = r.stats(); // healer not attached → empty self_healing
    expect(s.self_healing).toEqual({ actions: [], history: [] });
  });

  test('facade retry() and deadline() delegate with the shared budget and metrics', async () => {
    const r = new Resilience({ clock: fakeClock(), metrics: new Metrics() });
    let attempts = 0;
    const out = await r.retry(async () => { attempts += 1; if (attempts < 2) throw new Error('t'); return 'ok'; },
      { name: 'redis-get', sleep: () => Promise.resolve() });
    expect(out).toBe('ok');
    expect(r.budget('redis-get')).toBeTruthy(); // budget was created & shared
    await expect(r.deadline(Promise.resolve('fast'), 1000)).resolves.toBe('fast');
    await expect(r.retry(async () => { throw new Error('x'); }, { name: 'op', useBudget: false, attempts: 1, sleep: () => Promise.resolve() })).rejects.toThrow('x');
  });

  test('a breaker over ChaosKv fails fast during an outage and recovers after', async () => {
    const clock = fakeClock();
    const kv = new ChaosKv(new InMemoryKvAdapter({ clock: { nowMs: () => clock.nowMs() } }));
    const idem = new DistributedIdempotency({ kv });
    const cb = new CircuitBreaker({ clock, failureThreshold: 3, cooldownMs: 100 });
    const guarded = () => cb.exec(() => idem.runOnce(`k-${Math.random()}`, () => 'ok'));

    kv.down();
    // Trip the breaker on the outage.
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(guarded()).rejects.toThrow();
    }
    expect(cb.state).toBe('open');
    // While open, calls short-circuit WITHOUT touching the dead dependency.
    const callsBefore = kv.stats().calls;
    await expect(guarded()).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(kv.stats().calls).toBe(callsBefore); // dependency was spared
    // Recover: dependency healthy + cooldown elapsed → half-open probe closes.
    kv.up();
    clock.advance(150);
    await expect(guarded()).resolves.toMatchObject({ ran: true });
    expect(cb.state).toBe('closed');
  });
});

describe('branch coverage — defaults & guard rails', () => {
  test('modules construct with no arguments (default clock/metrics)', () => {
    expect(new CircuitBreaker().state).toBe('closed');
    expect(new Bulkhead().maxConcurrent).toBeGreaterThan(0);
    expect(new LoadShedder().maxInFlight).toBe(500);
    expect(new RetryBudget().ratio).toBe(0.1);
    const healer = new SelfHealer({ dependencies: { summary: () => ({}) } });
    expect(healer.stats().actions).toEqual([]);
  });

  test('circuit breaker rejects concurrent half-open probes beyond halfOpenMax', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker({ clock, failureThreshold: 1, cooldownMs: 10, halfOpenMax: 1 });
    await expect(cb.exec(async () => { throw new Error('e'); })).rejects.toThrow();
    clock.advance(20); // eligible for half-open
    let release;
    const gate = new Promise((r) => { release = r; });
    const probe = cb.exec(async () => gate); // enters half-open, holds the one slot
    await new Promise((r) => setImmediate(r));
    // A second concurrent call finds the half-open slot taken → short-circuits.
    await expect(cb.exec(async () => 'x')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    release('done');
    await probe;
  });

  test('self-healer ignores same-state and non-matching transitions', async () => {
    const state = { redis: 'healthy' };
    const deps = { summary: () => ({ ...state }) };
    let healed = 0;
    const healer = new SelfHealer({ dependencies: deps, clock: fakeClock() });
    healer.register('h', { dependency: 'redis', action: async () => { healed += 1; } });
    await healer.evaluate(); // baseline
    await healer.evaluate(); // redis unchanged → skip (before === after)
    expect(healed).toBe(0);
    state.redis = 'degraded'; // healthy→degraded is not a from∈{failed..}→to∈{recovering,healthy} match
    await healer.evaluate();
    expect(healed).toBe(0);
  });

  test('load shedder no-op when a lag provider returns null', () => {
    const shedder = new LoadShedder({ maxInFlight: 1000, lagProvider: () => null });
    expect(shedder.overloaded()).toBeNull();
  });
});

describe('M5 · RuntimeIntelligence', () => {
  test('sample() records heap/loop gauges into the shared registry', () => {
    const metrics = new Metrics();
    const ri = new RuntimeIntelligence({ clock: fakeClock(), metrics });
    const s = ri.sample();
    expect(s.heap_used_bytes).toBeGreaterThan(0);
    expect(s.heap_limit_bytes).toBeGreaterThan(0);
    expect(metrics.render()).toContain('motse_runtime_heap_used_bytes');
    expect(metrics.render()).toContain('motse_runtime_event_loop_utilization');
  });

  test('start()/stop() are idempotent and release the timer', () => {
    const ri = new RuntimeIntelligence({ clock: fakeClock(), sampleMs: 10 });
    ri.start();
    ri.start(); // idempotent — no second timer
    expect(ri.snapshot().sampling).toBe(true);
    ri.stop();
    expect(ri.snapshot().sampling).toBe(false);
    ri.stop(); // safe to call twice
  });

  test('detects a memory-leak trend and projects time-to-limit', () => {
    const clock = fakeClock();
    const ri = new RuntimeIntelligence({ clock, sampleMs: 60000 });
    // Synthesize a rising-heap window near the limit.
    const limit = 1_000_000_000;
    for (let i = 0; i < 10; i += 1) {
      ri.samples.push({
        at_ms: i * 60000, heap_used_bytes: 600_000_000 + i * 30_000_000,
        heap_limit_bytes: limit, heap_utilization: (600_000_000 + i * 30_000_000) / limit,
        event_loop_delay_p99_ms: 5, event_loop_utilization: 0.2, active_handles: 10,
      });
    }
    const leak = ri.insights().find((x) => x.kind === 'memory_leak_suspected');
    expect(leak).toBeTruthy();
    expect(leak.detail).toMatch(/min to limit/);
    expect(leak.severity).toBe('critical'); // <30min to limit
  });

  test('memory-leak detail humanizes large growth rates across units (KB/MB/GB)', () => {
    const clock = fakeClock();
    const mk = (perSampleGrowth, limit, startUtilBytes) => {
      const ri = new RuntimeIntelligence({ clock, sampleMs: 60000 });
      for (let i = 0; i < 6; i += 1) {
        const used = startUtilBytes + i * perSampleGrowth;
        ri.samples.push({
          at_ms: i * 60000, heap_used_bytes: used, heap_limit_bytes: limit,
          heap_utilization: used / limit, event_loop_delay_p99_ms: 1,
          event_loop_utilization: 0.1, active_handles: 5,
        });
      }
      return (ri.insights().find((x) => x.kind === 'memory_leak_suspected') || {}).detail || '';
    };
    // ~1.5GB/min growth → GB unit in the humanized detail.
    expect(mk(1_600_000_000, 20_000_000_000, 11_000_000_000)).toMatch(/GB\/min/);
    // ~2MB/min → MB unit.
    expect(mk(2_000_000, 100_000_000, 60_000_000)).toMatch(/MB\/min/);
    // ~50KB/min into a small limit → KB unit (still <120min to limit).
    expect(mk(50_000, 10_000_000, 6_000_000)).toMatch(/KB\/min/);
    // ~500B/min into a tiny limit → bytes unit.
    expect(mk(500, 100_000, 60_000)).toMatch(/\d+B\/min/);
  });

  test('warning-severity insights and handle-leak detection', () => {
    const clock = fakeClock();
    const ri = new RuntimeIntelligence({ clock, sampleMs: 60000 });
    const limit = 1_000_000_000;
    for (let i = 0; i < 8; i += 1) {
      // Slow leak: ~60min to limit → warning, not critical.
      const used = 800_000_000 + i * 3_000_000;
      ri.samples.push({
        at_ms: i * 60000, heap_used_bytes: used, heap_limit_bytes: limit,
        heap_utilization: used / limit,
        event_loop_delay_p99_ms: 200, // 100–500 → warning stall
        event_loop_utilization: 0.9, // 0.85–0.95 → warning saturation
        active_handles: 100 + i * 100, // +100/min → handle leak
      });
    }
    const insights = ri.insights();
    const byKind = Object.fromEntries(insights.map((x) => [x.kind, x]));
    expect(byKind.memory_leak_suspected.severity).toBe('warning');
    expect(byKind.event_loop_stall.severity).toBe('warning');
    expect(byKind.resource_exhaustion.severity).toBe('warning');
    expect(byKind.handle_leak_suspected).toBeTruthy();
  });

  test('detects event-loop stalls and sustained saturation', () => {
    const ri = new RuntimeIntelligence({ clock: fakeClock() });
    for (let i = 0; i < 5; i += 1) {
      ri.samples.push({
        at_ms: i * 5000, heap_used_bytes: 1e8, heap_limit_bytes: 1e9, heap_utilization: 0.1,
        event_loop_delay_p99_ms: 600, event_loop_utilization: 0.97, active_handles: 10,
      });
    }
    const kinds = ri.insights().map((x) => x.kind);
    expect(kinds).toContain('event_loop_stall');
    expect(kinds).toContain('resource_exhaustion');
  });

  test('too few samples yields no insights (no false positives at boot)', () => {
    const ri = new RuntimeIntelligence({ clock: fakeClock() });
    ri.samples.push({ at_ms: 0, heap_used_bytes: 1, heap_limit_bytes: 2, heap_utilization: 0.5, event_loop_delay_p99_ms: 0, event_loop_utilization: 0, active_handles: 0 });
    expect(ri.insights()).toEqual([]);
  });

  test('_recordGc accumulates major/minor pauses and emits the histogram', () => {
    const { constants } = require('perf_hooks');
    const metrics = new Metrics();
    const ri = new RuntimeIntelligence({ clock: fakeClock(), metrics });
    ri._recordGc({ duration: 12, detail: { kind: constants.NODE_PERFORMANCE_GC_MAJOR } });
    ri._recordGc({ duration: 3, detail: { kind: constants.NODE_PERFORMANCE_GC_MINOR } });
    expect(ri.gc).toMatchObject({ count: 2, major: 1, minor: 1 });
    expect(ri.gc.total_ms).toBe(15);
    expect(metrics.render()).toContain('motse_runtime_gc_pause_ms');
  });

  test('start() enables live sampling and snapshot reflects it; loopLagMs reads the latest sample', () => {
    const ri = new RuntimeIntelligence({ clock: fakeClock(), sampleMs: 100000 });
    ri.start();
    const snap = ri.snapshot();
    expect(snap.sampling).toBe(true);
    expect(snap.current).toBeTruthy();
    expect(typeof ri.loopLagMs()).toBe('number');
    ri.stop();
  });

  test('leastSquaresSlope is positive for a rising series, ~0 for flat', () => {
    expect(leastSquaresSlope([[0, 0], [1, 10], [2, 20], [3, 30]])).toBeCloseTo(10, 5);
    expect(leastSquaresSlope([[0, 5], [1, 5], [2, 5]])).toBeCloseTo(0, 5);
    expect(leastSquaresSlope([[0, 1]])).toBe(0); // single point → no slope
  });
});
