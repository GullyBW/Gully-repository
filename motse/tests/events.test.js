'use strict';

/**
 * Phase 5 (WS2/WS3) — platform Event Store + CQRS projections. The store is
 * an immutable append-only log tapping the event bus; projections fold it
 * into materialized read models that dashboards consume.
 */
const { world } = require('./helpers');
const { Store } = require('../src/kernel/store');
const { Clock } = require('../src/kernel/clock');
const { EventBus } = require('../src/kernel/eventBus');
const { EventStore } = require('../src/events/event.store');
const { ProjectionRegistry, SEED_PROJECTIONS } = require('../src/events/projections');

function bare() {
  const store = new Store();
  const clock = new Clock();
  const bus = new EventBus(clock);
  const eventStore = new EventStore({ store, clock, bus });
  return { store, clock, bus, eventStore };
}

function expectErr(fn, code) {
  let e;
  try { fn(); } catch (caught) { e = caught; }
  expect(e).toBeDefined();
  if (code) expect(e.code).toBe(code);
  return e;
}

describe('EventStore — append, read, filters', () => {
  test('assigns a global sequence and reads back with filters', () => {
    const { eventStore } = bare();
    eventStore.append({ streamId: 'identity', type: 'identity.registered', data: { user: 'u1' } });
    eventStore.append({ streamId: 'heritage', type: 'heritage.published', tenant: 'museum', data: { item: 'h1' } });
    eventStore.append({ streamId: 'identity', type: 'identity.verified', data: { user: 'u1' } });
    expect(eventStore.read().map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(eventStore.read({ stream: 'identity' })).toHaveLength(2);
    expect(eventStore.read({ type: 'heritage.published' })).toHaveLength(1);
    expect(eventStore.read({ tenant: 'museum' })).toHaveLength(1);
    expect(eventStore.read({ fromSeq: 1, toSeq: 2 }).map((e) => e.seq)).toEqual([2]);
    expectErr(() => eventStore.append({ type: null }), 'INVALID_ARGUMENT');
  });

  test('persists every event the bus publishes, deriving the stream', () => {
    const { bus, eventStore } = bare();
    bus.register('payments.done', 1, ['id']);
    bus.register('scoped.event', 1, []);
    bus.register('agg.event', 1, []);
    bus.publish('payments.done', { id: 'p1' }); // stream derived from domain "payments"
    bus.publish('scoped.event', { stream_id: 'agg:7', tenant: 'ngo' }); // explicit stream + tenant
    bus.publish('agg.event', { aggregate_id: 'agg:8' }); // stream from aggregate_id
    expect(eventStore.read({ stream: 'payments' })).toHaveLength(1);
    const scoped = eventStore.read({ stream: 'agg:7' });
    expect(scoped).toHaveLength(1);
    expect(scoped[0].tenant).toBe('ngo');
    expect(scoped[0].source_id).toBeTruthy(); // links back to the bus event
    expect(eventStore.read({ stream: 'agg:8' })).toHaveLength(1);
  });

  test('a throwing append subscriber never breaks the append', () => {
    const { eventStore } = bare();
    eventStore.onAppend(() => { throw new Error('projection blew up'); });
    expect(() => eventStore.append({ type: 'x.y', data: {} })).not.toThrow();
    expect(eventStore.read()).toHaveLength(1);
  });
});

describe('EventStore — versioning, snapshots, time-travel', () => {
  test('upcasters evolve old event versions to the current shape (chained)', () => {
    const { eventStore } = bare();
    eventStore.append({ type: 'profile.updated', version: 1, data: { name: 'Kefilwe' } });
    eventStore.registerUpcaster('profile.updated', 1, (data) => ({ data: { ...data, locale: 'tn' }, version: 2 }));
    eventStore.registerUpcaster('profile.updated', 2, (data) => ({ data: { ...data, v: 3 } })); // version defaults to +1
    const [evt] = eventStore.read({ type: 'profile.updated' });
    expect(evt.version).toBe(3);
    expect(evt.data).toEqual({ name: 'Kefilwe', locale: 'tn', v: 3 });
    // An upcaster may also return the bare next-data object (no {data} wrapper).
    eventStore.append({ type: 'legacy.event', version: 1, data: { a: 1 } });
    eventStore.registerUpcaster('legacy.event', 1, (data) => ({ ...data, b: 2 }));
    expect(eventStore.read({ type: 'legacy.event' })[0].data).toEqual({ a: 1, b: 2 });
  });

  test('snapshots + rebuild fold only the tail; rebuild works without a snapshot', () => {
    const { eventStore } = bare();
    const reducer = (s, e) => ({ ...s, total: s.total + e.data.amt });
    eventStore.append({ streamId: 'acc:1', type: 'credited', data: { amt: 10 } });
    eventStore.append({ streamId: 'acc:1', type: 'credited', data: { amt: 5 } });
    expect(eventStore.rebuild('acc:1', reducer, { total: 0 })).toEqual({ total: 15 });
    expect(eventStore.loadSnapshot('acc:1')).toBeNull();
    eventStore.snapshot('acc:1', { total: 15 });
    eventStore.append({ streamId: 'acc:1', type: 'credited', data: { amt: 7 } });
    // Rebuild = snapshot(15) + only the one event after it.
    expect(eventStore.rebuild('acc:1', reducer, { total: 0 })).toEqual({ total: 22 });
    expect(eventStore.loadSnapshot('acc:1').seq).toBe(2);
  });

  test('time-travel reads the log as of a timestamp; fold/replay/stats', () => {
    const { eventStore } = bare();
    eventStore.append({ streamId: 's', type: 'e', data: { n: 1 }, occurredAt: '2026-01-01T00:00:00.000Z' });
    eventStore.append({ streamId: 's', type: 'e', data: { n: 2 }, occurredAt: '2026-06-01T00:00:00.000Z' });
    expect(eventStore.timeTravel('2026-03-01T00:00:00.000Z')).toHaveLength(1);
    expect(eventStore.fold((sum, e) => sum + e.data.n, 0)).toBe(3);
    let replayed = 0;
    expect(eventStore.replay(() => { replayed += 1; }).replayed).toBe(2);
    expect(replayed).toBe(2);
    const stats = eventStore.stats();
    expect(stats).toMatchObject({ total: 2, high_seq: 2, streams: 1 });
    expect(stats.by_type.e).toBe(2);
  });
});

describe('ProjectionRegistry (CQRS) — materialized read models', () => {
  function setup() {
    const b = bare();
    const projections = new ProjectionRegistry({ store: b.store, clock: b.clock, eventStore: b.eventStore });
    return { ...b, projections };
  }

  test('backfills on register and updates live as events append', () => {
    const { bus, projections } = setup();
    bus.register('vote.cast', 1, []);
    bus.publish('vote.cast', {});
    bus.publish('vote.cast', {});
    projections.register({
      name: 'votes',
      initial: { count: 0 },
      on: { 'vote.cast': (s) => ({ ...s, count: s.count + 1 }) },
    });
    expect(projections.read('votes')).toEqual({ count: 2 }); // backfilled
    bus.publish('vote.cast', {});
    expect(projections.read('votes')).toEqual({ count: 3 }); // live
  });

  test('view reports lag; rebuild replays from zero; re-register is idempotent', () => {
    const { bus, projections } = setup();
    bus.register('ping', 1, []);
    projections.register({ name: 'pings', initial: { n: 0 }, on: { ping: (s) => ({ n: s.n + 1 }) } });
    bus.publish('ping', {});
    const v = projections.view('pings');
    expect(v.state).toEqual({ n: 1 });
    expect(v.lag).toBe(0);
    expect(projections.rebuild('pings')).toEqual({ n: 1 });
    expect(projections.list().find((p) => p.name === 'pings')).toBeTruthy();
    // Re-registering the same name returns the existing projection.
    expect(projections.register({ name: 'pings', on: {} }).name).toBe('pings');
    expectErr(() => projections.read('nope'), 'NOT_FOUND');
  });

  test('an event with no matching reducer advances position without changing state', () => {
    const { bus, projections } = setup();
    bus.register('a', 1, []); bus.register('b', 1, []);
    projections.register({ name: 'as', initial: { n: 0 }, on: { a: (s) => ({ n: s.n + 1 }) } });
    bus.publish('b', {}); // no reducer for 'b'
    bus.publish('a', {});
    expect(projections.read('as')).toEqual({ n: 1 });
    expect(projections.view('as').position).toBe(2); // advanced past both
  });

  test('the seed projections fold every tracked event type; register defaults initial', () => {
    const { bus, projections } = setup();
    for (const p of SEED_PROJECTIONS) projections.register(p);
    const types = [
      'payments.intent.completed', 'card.captured', 'card.refunded', 'card.chargeback',
      'heritage.item.published', 'heritage.item.validated',
      'kgetsi.contribution.received', 'loeto.booking.settled',
      'qr.generated', 'qr.scanned', 'qr.revoked',
    ];
    for (const t of types) { bus.register(t, 1, []); bus.publish(t, { amount_minor: 100, kind: 'x' }); }
    const pa = projections.read('platform_activity');
    expect(pa.total).toBe(types.length);
    expect(Object.keys(pa.by_type)).toHaveLength(types.length);
    const ps = projections.read('payments_summary');
    expect(ps).toMatchObject({ captures: 1, captured_minor: 100, refunded_minor: 100, chargebacks: 1 });
    const qa = projections.read('qr_activity');
    expect(qa).toMatchObject({ generated: 1, scanned: 1, revoked: 1 });
    // register without an explicit initial defaults to {}.
    projections.register({ name: 'noinit', on: {} });
    expect(projections.read('noinit')).toEqual({});
  });

  test('seed reducers tolerate events missing amount/kind (defensive fallbacks)', () => {
    const { bus, projections } = setup();
    for (const p of SEED_PROJECTIONS) projections.register(p);
    bus.register('card.captured', 1, []); bus.register('card.refunded', 1, []); bus.register('qr.generated', 1, []);
    bus.publish('card.captured', {}); // no amount_minor → || 0
    bus.publish('card.refunded', {}); // no amount_minor → || 0
    bus.publish('qr.generated', {}); // no kind → || 'unknown'
    expect(projections.read('payments_summary')).toMatchObject({ captures: 1, captured_minor: 0, refunded_minor: 0 });
    expect(projections.read('qr_activity').by_kind.unknown).toBe(1);
  });
});

describe('Event Store + CQRS — integrated with the live platform', () => {
  test('domain events are recorded and seed projections fold them', () => {
    const w = world();
    const dest = w.p.ledger.openAccount('merchant', 'community_trust').id;
    const card = w.p.cards.saveCard(w.kabo.id, { hostedFieldRef: 'hf', brand: 'visa', last4: '4242' });
    const intent = w.p.cards.createIntent(w.kabo.id, { amountMinor: 25000, destAccountId: dest, cardId: card.id, idempotencyKey: 'ev-1' });
    w.p.cards.capture(intent.id, { idempotencyKey: 'ev-1c' });
    w.p.cards.refund(intent.id, { amountMinor: 5000, idempotencyKey: 'ev-1r' });

    expect(w.p.eventStore.read({ type: 'card.captured' })).toHaveLength(1);
    const ps = w.p.projections.read('payments_summary');
    expect(ps).toMatchObject({ captured_minor: 25000, refunded_minor: 5000, captures: 1 });
    const pa = w.p.projections.read('platform_activity');
    expect(pa.by_type['card.captured']).toBe(1);
    expect(pa.total).toBeGreaterThanOrEqual(2);
    expect(w.p.eventStore.stats().total).toBeGreaterThan(0);
  });
});
