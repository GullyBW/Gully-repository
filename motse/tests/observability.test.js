'use strict';

/**
 * Phase 2 — Operational observability. Two additive substrates verified here:
 *
 *   1. The dependency-free, OpenTelemetry-compatible Tracer: spans nest via
 *      AsyncLocalStorage across sync/async boundaries, carry W3C trace-context
 *      ids, and are queryable (trace/recent/stats) from a bounded ring buffer.
 *   2. Foundation instrumentation: transactions, the transactional outbox and
 *      the distributed runtime record Prometheus metrics into the shared
 *      registry — WITHOUT changing behaviour (the metrics param is optional and
 *      defaults to a no-op, so uninstrumented construction is unaffected).
 */
const { Tracer } = require('../src/observability/tracer');
const { Metrics } = require('../src/monitoring/metrics');
const { Store } = require('../src/kernel/store');
const { Clock } = require('../src/kernel/clock');
const { EventBus } = require('../src/kernel/eventBus');
const { OutboxService } = require('../src/persistence/outbox');
const { createKv } = require('../src/distributed/kv');
const {
  DistributedIdempotency,
  DistributedRateLimiter,
  DistributedLock,
} = require('../src/distributed/services');

describe('Tracer — spans & context propagation', () => {
  test('startSpan produces W3C ids and an ok status; end computes duration', () => {
    let t = 100;
    const clock = { nowMs: () => (t += 5), nowIso: () => new Date(t).toISOString() };
    const tracer = new Tracer({ clock });
    const span = tracer.startSpan('unit', { attributes: { a: 1 } });
    expect(span.trace_id).toMatch(/^[0-9a-f]{32}$/);
    expect(span.span_id).toMatch(/^[0-9a-f]{16}$/);
    expect(span.parent_id).toBeNull();
    expect(span.status).toBe('ok');
    expect(span.attributes).toEqual({ a: 1 });
    span.setAttribute('b', 2).addEvent('checkpoint', { k: 'v' });
    span.end();
    expect(span.attributes.b).toBe(2);
    expect(span.events[0]).toMatchObject({ name: 'checkpoint', attrs: { k: 'v' } });
    expect(span.duration_ms).toBeGreaterThanOrEqual(0);
  });

  test('constructs with no arguments (defaults) and records a span', () => {
    const tracer = new Tracer();
    const span = tracer.startSpan('bare');
    span.addEvent('no-attrs'); // default attrs = {}
    span.end({ error: 'a plain string error' }); // error without a .message
    expect(span.status).toBe('error');
    expect(span.attributes.error).toBe('a plain string error');
    expect(span.events[0]).toMatchObject({ name: 'no-attrs', attrs: {} });
    expect(tracer.stats().max_spans).toBe(2000);
  });

  test('end is idempotent — a second end does not re-record or change duration', () => {
    const tracer = new Tracer({});
    const span = tracer.startSpan('once');
    span.end();
    const d = span.duration_ms;
    span.end();
    expect(span.duration_ms).toBe(d);
    expect(tracer.stats().spans).toBe(1);
  });

  test('withSpan nests child spans under the active parent (sync)', () => {
    const tracer = new Tracer({});
    let childTrace;
    let childParent;
    let rootId;
    tracer.withSpan('root', (root) => {
      rootId = root.span_id;
      tracer.withSpan('child', (child) => {
        childTrace = child.trace_id;
        childParent = child.parent_id;
        expect(child.trace_id).toBe(root.trace_id);
      });
    });
    expect(childParent).toBe(rootId);
    expect(tracer.trace(childTrace)).toHaveLength(2);
  });

  test('withSpan propagates context across async boundaries and records errors', async () => {
    const tracer = new Tracer({});
    let traceId;
    await tracer.withSpan('async-root', async (root) => {
      traceId = root.trace_id;
      await Promise.resolve();
      await tracer.withSpan('async-child', async (child) => {
        expect(child.parent_id).toBe(root.span_id);
        await Promise.resolve();
      });
    });
    await expect(
      tracer.withSpan('boom', async () => {
        throw new Error('kaboom');
      })
    ).rejects.toThrow('kaboom');
    const failed = tracer.spans.find((s) => s.name === 'boom');
    expect(failed.status).toBe('error');
    expect(failed.attributes.error).toBe('kaboom');
    expect(tracer.trace(traceId)).toHaveLength(2);
  });

  test('withSpan records synchronous throws and re-raises', () => {
    const tracer = new Tracer({});
    expect(() =>
      tracer.withSpan('sync-boom', () => {
        throw new Error('sync-fail');
      })
    ).toThrow('sync-fail');
    const span = tracer.spans.find((s) => s.name === 'sync-boom');
    expect(span.status).toBe('error');
  });

  test('runInContext / currentContext bind an explicit trace for a continuation', () => {
    const tracer = new Tracer({});
    expect(tracer.currentContext()).toBeNull();
    const ctx = { traceId: 'abc', spanId: 'def' };
    const seen = tracer.runInContext(ctx, () => {
      const span = tracer.startSpan('under-ctx');
      return { active: tracer.currentContext(), span };
    });
    expect(seen.active).toEqual(ctx);
    expect(seen.span.trace_id).toBe('abc');
    expect(seen.span.parent_id).toBe('def');
  });

  test('enter sets the active context for the current scope', () => {
    const tracer = new Tracer({});
    const run = () => {
      tracer.enter({ traceId: 'xyz', spanId: 's1' });
      return tracer.startSpan('after-enter').trace_id;
    };
    // enterWith mutates the current async scope; isolate it in als.run.
    const traceId = tracer.runInContext(undefined, run);
    expect(traceId).toBe('xyz');
  });

  test('recent summarises distinct traces newest-first and flags errors', () => {
    let t = 0;
    const clock = { nowMs: () => (t += 1), nowIso: () => new Date(1700000000000 + t).toISOString() };
    const tracer = new Tracer({ clock });
    tracer.withSpan('req-a', () => {});
    tracer.withSpan('req-b', (s) => s.end({ error: new Error('x') }));
    const recent = tracer.recent(10);
    expect(recent).toHaveLength(2);
    // req-b started later, so it sorts first.
    expect(recent[0].root).toBe('req-b');
    expect(recent[0].status).toBe('error');
    expect(recent[1].status).toBe('ok');
    expect(recent[0]).toMatchObject({ spans: 1 });
  });

  test('recent respects the limit', () => {
    const tracer = new Tracer({});
    for (let i = 0; i < 5; i += 1) tracer.withSpan(`r${i}`, () => {});
    expect(tracer.recent(2)).toHaveLength(2);
  });

  test('recent() defaults its limit and handles a trace whose root is external', () => {
    const tracer = new Tracer({});
    // A span recorded under an inbound (cross-service) context has a parent id
    // but no parentless root in this process — recent() falls back to spans[0].
    tracer.runInContext({ traceId: 'ext-trace', spanId: 'upstream-span' }, () => {
      tracer.startSpan('local-child').end();
    });
    const recent = tracer.recent(); // no argument → default limit
    const entry = recent.find((r) => r.trace_id === 'ext-trace');
    expect(entry).toMatchObject({ root: 'local-child', spans: 1, status: 'ok' });
  });

  test('the ring buffer is bounded by maxSpans (oldest evicted)', () => {
    const tracer = new Tracer({ maxSpans: 3 });
    for (let i = 0; i < 6; i += 1) tracer.startSpan(`s${i}`).end();
    expect(tracer.spans).toHaveLength(3);
    expect(tracer.spans.map((s) => s.name)).toEqual(['s3', 's4', 's5']);
    expect(tracer.stats().max_spans).toBe(3);
  });

  test('a sink exporter receives finished spans and its failures never bubble', () => {
    const exported = [];
    let calls = 0;
    const tracer = new Tracer({
      sink: (s) => {
        calls += 1;
        if (s.name === 'bad') throw new Error('exporter down');
        exported.push(s.name);
      },
    });
    tracer.startSpan('good').end();
    expect(() => tracer.startSpan('bad').end()).not.toThrow();
    expect(exported).toEqual(['good']);
    expect(calls).toBe(2);
    // Exported spans are plain data (no live methods leaked).
    expect(typeof tracer.spans[0].end).toBe('undefined');
  });

  test('W3C traceparent format and parse round-trip', () => {
    const traceId = 'a'.repeat(32);
    const spanId = 'b'.repeat(16);
    const header = Tracer.formatTraceparent(traceId, spanId);
    expect(header).toBe(`00-${traceId}-${spanId}-01`);
    expect(Tracer.parseTraceparent(header)).toEqual({ traceId, spanId, flags: '01' });
  });

  test('parseTraceparent rejects malformed / unsupported headers', () => {
    expect(Tracer.parseTraceparent('')).toBeNull();
    expect(Tracer.parseTraceparent(null)).toBeNull();
    expect(Tracer.parseTraceparent('garbage')).toBeNull();
    expect(Tracer.parseTraceparent('99-a-b-01')).toBeNull(); // unsupported version
    expect(Tracer.parseTraceparent('00-a-b')).toBeNull(); // too few parts
  });

  test('trace() returns spans in start order for one trace only', () => {
    let t = 0;
    const clock = { nowMs: () => (t += 1), nowIso: () => new Date(t).toISOString() };
    const tracer = new Tracer({ clock });
    let outerTrace;
    tracer.withSpan('outer', (outer) => {
      outerTrace = outer.trace_id;
      tracer.withSpan('inner', () => {});
    });
    tracer.withSpan('unrelated', () => {}); // different trace
    const spans = tracer.trace(outerTrace);
    expect(spans.map((s) => s.name)).toEqual(['outer', 'inner']);
  });
});

describe('Foundation instrumentation — transactions', () => {
  test('commits and rollbacks are counted and timed in the shared registry', () => {
    const metrics = new Metrics();
    const store = new Store({ metrics });
    const c = store.collection('acc');
    store.transaction(() => c.insert({ id: 'a', v: 1 }));
    expect(() =>
      store.transaction(() => {
        c.insert({ id: 'b', v: 2 });
        throw new Error('rollback me');
      })
    ).toThrow('rollback me');
    expect(metrics.counterValue('foundation_transaction_total', { result: 'commit' })).toBe(1);
    expect(metrics.counterValue('foundation_transaction_total', { result: 'rollback' })).toBe(1);
    // The rolled-back insert did not persist.
    expect(c.get('b')).toBeNull();
    // Timing histogram observed at least the commit + rollback.
    expect(metrics.render()).toContain('foundation_transaction_ms');
  });

  test('a Store built without metrics still works (no-op default)', () => {
    const store = new Store();
    const c = store.collection('x');
    expect(store.transaction(() => c.insert({ id: '1' }) && 'ok')).toBe('ok');
  });
});

describe('Foundation instrumentation — outbox', () => {
  function setup(bus) {
    const store = new Store();
    const clock = new Clock();
    const metrics = new Metrics();
    const outbox = new OutboxService({ store, clock, bus, maxAttempts: 2, metrics });
    return { store, clock, metrics, outbox };
  }

  test('published rows increment the published counter and a backlog sample', () => {
    const bus = new EventBus(new Clock());
    bus.register('thing.happened', 1, ['n']);
    const { metrics, outbox } = setup(bus);
    outbox.run(({ stage }) => stage('thing.happened', { n: 1 }));
    expect(metrics.counterValue('foundation_outbox_published_total', { type: 'thing.happened' })).toBe(1);
    const text = metrics.render();
    expect(text).toContain('foundation_outbox_publish_ms');
    expect(text).toContain('foundation_outbox_backlog');
  });

  test('a failing publish retries then dead-letters, both counted', () => {
    const bus = new EventBus(new Clock());
    bus.register('will.fail', 1, ['n']);
    let attempts = 0;
    bus.subscribe('will.fail', 'flaky', () => {
      attempts += 1;
      throw new Error('consumer down');
    });
    const { metrics, outbox } = setup(bus); // maxAttempts: 2
    outbox.run(({ stage }) => stage('will.fail', { n: 1 })); // 1st publish attempt fails → retried
    outbox.drain(); // 2nd attempt fails → dead-lettered
    expect(attempts).toBe(2);
    expect(metrics.counterValue('foundation_outbox_retried_total', { type: 'will.fail' })).toBe(1);
    expect(metrics.counterValue('foundation_outbox_dead_total', { type: 'will.fail' })).toBe(1);
  });

  test('a tracer wraps outbox.drain in a span', () => {
    const bus = new EventBus(new Clock());
    bus.register('traced.evt', 1, ['n']);
    const store = new Store();
    const clock = new Clock();
    const tracer = new Tracer({ clock });
    const outbox = new OutboxService({ store, clock, bus, tracer });
    outbox.run(({ stage }) => stage('traced.evt', { n: 1 }));
    expect(tracer.spans.some((s) => s.name === 'outbox.drain')).toBe(true);
  });
});

describe('Foundation instrumentation — distributed runtime', () => {
  test('idempotency counts first vs duplicate execution', async () => {
    const metrics = new Metrics();
    const kv = createKv({ clock: new Clock() });
    const idem = new DistributedIdempotency({ kv, metrics });
    const first = await idem.runOnce('k1', () => 42);
    const dupe = await idem.runOnce('k1', () => 99);
    expect(first).toEqual({ ran: true, result: 42 });
    expect(dupe).toEqual({ ran: false });
    expect(metrics.counterValue('foundation_idempotency_total', { result: 'first' })).toBe(1);
    expect(metrics.counterValue('foundation_idempotency_total', { result: 'duplicate' })).toBe(1);
  });

  test('a throwing fn releases the reservation and does not count a duplicate', async () => {
    const metrics = new Metrics();
    const kv = createKv({ clock: new Clock() });
    const idem = new DistributedIdempotency({ kv, metrics });
    await expect(idem.runOnce('k2', () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // Reservation released → a retry runs again (still 'first', never 'duplicate').
    const retry = await idem.runOnce('k2', () => 'ok');
    expect(retry).toEqual({ ran: true, result: 'ok' });
    expect(metrics.counterValue('foundation_idempotency_total', { result: 'first' })).toBe(2);
    expect(metrics.counterValue('foundation_idempotency_total', { result: 'duplicate' })).toBe(0);
  });

  test('rate limiter counts allowed vs limited', async () => {
    const metrics = new Metrics();
    const kv = createKv({ clock: new Clock() });
    const rl = new DistributedRateLimiter({ kv, clock: new Clock(), capacity: 1, windowMs: 60000, metrics });
    const a = await rl.take('id-1');
    const b = await rl.take('id-1');
    expect(a.allowed).toBe(true);
    expect(b.allowed).toBe(false);
    expect(metrics.counterValue('foundation_ratelimit_total', { result: 'allowed' })).toBe(1);
    expect(metrics.counterValue('foundation_ratelimit_total', { result: 'limited' })).toBe(1);
  });

  test('lock counts acquired vs contended', async () => {
    const metrics = new Metrics();
    const kv = createKv({ clock: new Clock() });
    const lock = new DistributedLock({ kv, metrics });
    let held = 0;
    await lock.withLock('res', async () => {
      held += 1;
      // A nested attempt on the same key is contended.
      await expect(lock.withLock('res', async () => {})).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    });
    expect(held).toBe(1);
    expect(metrics.counterValue('foundation_lock_total', { result: 'acquired' })).toBe(1);
    expect(metrics.counterValue('foundation_lock_total', { result: 'contended' })).toBe(1);
  });

  test('the distributed services run identically without metrics (no-op default)', async () => {
    const kv = createKv({ clock: new Clock() });
    const idem = new DistributedIdempotency({ kv });
    expect(await idem.runOnce('nom', () => 1)).toEqual({ ran: true, result: 1 });
  });
});
