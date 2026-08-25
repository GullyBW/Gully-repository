'use strict';
// Event-Driven Government Integration Platform (Phase 28). An enterprise EVENT BUS built on
// the existing MessageBroker (reused, not replaced): topic registry, publish/subscribe with
// FILTERING, per-topic ORDERING, REPLAY services, a subscriber registry, at-least-once
// DELIVERY, DLQ governance, and cross-agency event FEDERATION. Deterministic, zero-dependency.
//
// PII-free is inherited from the broker (identity/content refused). Production adapters are
// documented drop-ins: Kafka, NATS, Azure Event Hub, AWS EventBridge, Google Pub/Sub — each
// implements the same publish/subscribe/replay contract.
const { MessageBroker } = require('../adapters/broker');

const PRODUCTION_DRIVERS = ['kafka', 'nats', 'azure-event-hub', 'aws-eventbridge', 'google-pubsub'];

class EnterpriseEventBus {
  constructor({ clock = () => Date.now() } = {}) {
    this._clock = clock;
    this._broker = new MessageBroker({ clock });
    this._topics = new Map();          // topic -> { owner, ordered }
    this._subs = new Map();            // subId -> { topic, subscriber, filter }
    this._log = new Map();             // topic -> ordered event[]
    this._seq = new Map();             // topic -> next seq
  }

  registerTopic(topic, { owner = 'platform', ordered = true } = {}) { this._topics.set(topic, { owner, ordered }); this._log.set(topic, []); this._seq.set(topic, 0); return { topic, owner, ordered }; }
  topics() { return [...this._topics.entries()].map(([t, m]) => ({ topic: t, ...m, depth: (this._log.get(t) || []).length })); }

  // Subscribe with an optional declarative FILTER (predicate over the payload's safe fields).
  subscribe(topic, subscriber, handler, { filter } = {}) {
    if (!this._topics.has(topic)) throw new Error('unknown topic: ' + topic);
    const subId = `${topic}:${subscriber}`;
    this._subs.set(subId, { topic, subscriber, filter: filter || null });
    this._broker.subscribe(topic, (payload, evt) => { if (matchFilter(filter, payload)) handler(payload, evt); });
    return { subId };
  }
  subscribers(topic) { return [...this._subs.values()].filter((s) => !topic || s.topic === topic); }

  // Publish: PII-free (broker), assigned a per-topic ORDER, appended to the replay log, drained.
  publish(topic, payload = {}) {
    if (!this._topics.has(topic)) throw new Error('unknown topic: ' + topic);
    const ref = this._broker.publish(topic, payload); // enforces PII-free FIRST (throws → no seq consumed)
    const seq = this._seq.get(topic) + 1; this._seq.set(topic, seq);
    this._log.get(topic).push({ seq, payload, at: this._clock(), id: ref.id });
    const delivered = this._broker.drain();           // at-least-once delivery
    return { topic, seq, delivered };
  }

  // Replay service: re-deliver ordered events from a sequence (event replay / catch-up).
  replay(topic, { fromSeq = 0, to } = {}) {
    const log = (this._log.get(topic) || []).filter((e) => e.seq > fromSeq && (to == null || e.seq <= to));
    return log.map((e) => ({ seq: e.seq, payload: e.payload, at: e.at }));
  }
  // DLQ governance: inspect and replay dead-lettered events (delegates to the broker).
  deadLetters() { return this._broker.deadLetters(); }
  replayDeadLetters() { return this._broker.replayDeadLetters(); }
  auditTrail(topic) { return this.replay(topic).map((e) => ({ seq: e.seq, at: e.at })); }

  // Cross-agency FEDERATION: forward a topic's events to a federated bus IF an explicit
  // federation grant exists (checked by the caller/federation registry). PII-free enforced.
  federate(topic, targetBus, { targetTopic } = {}) {
    const tt = targetTopic || topic;
    if (!targetBus._topics.has(tt)) targetBus.registerTopic(tt, { owner: 'federated' });
    let forwarded = 0;
    for (const e of this._log.get(topic) || []) { targetBus.publish(tt, e.payload); forwarded++; }
    return { topic, targetTopic: tt, forwarded };
  }
}

function matchFilter(filter, payload) {
  if (!filter) return true;
  return Object.entries(filter).every(([k, val]) => payload[k] === val);
}

function makeEventBus(cfg = {}) {
  if (cfg.eventBus && cfg.eventBus !== 'memory') {
    if (!PRODUCTION_DRIVERS.includes(cfg.eventBus)) throw new Error('unknown event-bus driver: ' + cfg.eventBus);
    throw new Error(`event-bus driver '${cfg.eventBus}' is a documented drop-in; not bundled in-repo (docs/production-adapters.md)`);
  }
  return new EnterpriseEventBus({ clock: cfg.clock });
}

module.exports = { EnterpriseEventBus, makeEventBus, PRODUCTION_DRIVERS };
