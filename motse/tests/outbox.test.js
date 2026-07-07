'use strict';

/**
 * Foundation F2 — transactional outbox. Domain writes and the events they
 * emit commit atomically; a relay delivers events at-least-once with bounded
 * retry and a dead-letter queue; consumers stay idempotent.
 */
const { Store } = require('../src/kernel/store');
const { Clock } = require('../src/kernel/clock');
const { EventBus } = require('../src/kernel/eventBus');
const { OutboxService } = require('../src/persistence/outbox');

function setup() {
  const store = new Store();
  const clock = new Clock();
  const bus = new EventBus(clock);
  bus.register('thing.happened', 1, ['n']);
  const outbox = new OutboxService({ store, clock, bus, maxAttempts: 3 });
  const state = store.collection('state');
  const delivered = [];
  bus.subscribe('thing.happened', 'consumer', (e) => delivered.push(e.data));
  return { store, clock, bus, outbox, state, delivered };
}

function expectErr(fn, code) {
  let e;
  try { fn(); } catch (caught) { e = caught; }
  expect(e).toBeDefined();
  if (code) expect(e.code).toBe(code);
  return e;
}

describe('Transactional outbox — atomicity', () => {
  test('state change and event commit together, then the event is delivered', () => {
    const { outbox, state, delivered } = setup();
    outbox.run(({ stage }) => {
      state.insert({ id: 's1', ok: true });
      stage('thing.happened', { n: 1 });
    });
    expect(state.get('s1')).toMatchObject({ ok: true });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ n: 1, outbox_id: expect.any(String) });
    expect(outbox.stats()).toMatchObject({ published: 1, pending: 0, dead: 0 });
  });

  test('if the work throws, neither the state nor the event survives', () => {
    const { outbox, state, delivered } = setup();
    expectErr(() => outbox.run(({ stage }) => {
      state.insert({ id: 's2' });
      stage('thing.happened', { n: 2 });
      throw new Error('domain failure');
    }));
    expect(state.get('s2')).toBeNull(); // rolled back
    expect(delivered).toHaveLength(0); // never staged → never published
    expect(outbox.stats().total).toBe(0);
  });

  test('staging requires an event type', () => {
    const { outbox } = setup();
    expectErr(() => outbox.run(({ stage }) => stage()), 'INVALID_ARGUMENT');
  });
});

describe('Transactional outbox — at-least-once delivery, retry, DLQ', () => {
  test('a transient publish failure is retried on the next drain', () => {
    const { outbox, bus, delivered } = setup();
    let fail = true;
    const original = bus.publish.bind(bus);
    bus.publish = (type, data) => {
      if (fail) { fail = false; throw new Error('bus unavailable'); }
      return original(type, data);
    };
    outbox.run(({ stage }) => stage('thing.happened', { n: 3 }));
    // First drain failed → row is pending with 1 attempt, not delivered yet.
    expect(delivered).toHaveLength(0);
    expect(outbox.stats()).toMatchObject({ pending: 1, published: 0 });
    // Relay recovery: a subsequent drain delivers it.
    outbox.drain();
    expect(delivered).toHaveLength(1);
    expect(outbox.stats()).toMatchObject({ published: 1, pending: 0 });
  });

  test('a permanently failing event lands in the dead-letter queue', () => {
    const { outbox, bus } = setup();
    bus.publish = () => { throw new Error('always fails'); };
    outbox.run(({ stage }) => stage('thing.happened', { n: 4 }));
    outbox.drain();
    outbox.drain(); // exceed maxAttempts (3)
    expect(outbox.stats().dead).toBe(1);
    expect(outbox.deadLetters()).toHaveLength(1);
    expect(outbox.deadLetters()[0]).toMatchObject({ type: 'thing.happened', error: 'always fails' });
  });

  test('dead letters can be replayed once delivery recovers', () => {
    const { outbox, bus, delivered } = setup();
    bus.publish = () => { throw new Error('down'); };
    outbox.run(({ stage }) => stage('thing.happened', { n: 5 }));
    outbox.drain(); outbox.drain();
    const dead = outbox.deadLetters()[0];
    // Recover the bus, replay the dead letter.
    const { EventBus } = require('../src/kernel/eventBus');
    bus.publish = EventBus.prototype.publish.bind(bus);
    const out = outbox.replayDead(dead.id);
    expect(out.replayed).toBeTruthy();
    expect(delivered).toHaveLength(1);
    expect(outbox.stats().dead).toBe(0);
    expectErr(() => outbox.replayDead('dlq_missing'), 'NOT_FOUND');
  });

  test('drain is idempotent — re-draining does not double-publish', () => {
    const { outbox, delivered } = setup();
    outbox.run(({ stage }) => stage('thing.happened', { n: 6 }));
    outbox.drain();
    outbox.drain();
    expect(delivered).toHaveLength(1); // published rows are skipped
  });

  test('defaults: maxAttempts is applied and a payloadless event is delivered', () => {
    const store = new Store();
    const clock = new Clock();
    const bus = new EventBus(clock);
    bus.register('e', 1, []);
    const delivered = [];
    bus.subscribe('e', 'c', (x) => delivered.push(x.data));
    const outbox = new OutboxService({ store, clock, bus }); // default maxAttempts (5)
    outbox.run(({ stage }) => stage('e')); // no data → {}
    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({ outbox_id: expect.any(String) });
  });
});
