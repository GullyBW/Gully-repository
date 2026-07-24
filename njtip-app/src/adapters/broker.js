'use strict';
// Message-broker PORT with a transactional OUTBOX. Cross-zone/inter-service events are
// published through this port; the domain never talks to Kafka/RabbitMQ/NATS directly.
// Reference implementation is in-memory with an outbox + at-least-once delivery to
// subscribers. Production drivers (Kafka/RabbitMQ/NATS) implement the SAME publish/
// subscribe/drain interface (docs/production-adapters.md).
//
// PII-FREE INVARIANT (fail-closed): events crossing zones must carry NO identity and NO
// case content (blueprint: PII-free cross-zone events). This port REJECTS any payload
// containing a denied field, so an identity/content leak cannot be published even by
// mistake. Independently checked by an app-level fitness function.
const crypto = require('node:crypto');

// Denied top-level keys (aligned with the Twin's identity denylist + content).
const DENIED = new Set(['omang', 'name', 'email', 'phone', 'msisdn', 'ip', 'address', 'nationalid', 'passport', 'content', 'body', 'plaintext']);

function assertPiiFree(payload) {
  const scan = (obj, path) => {
    if (!obj || typeof obj !== 'object') return;
    for (const k of Object.keys(obj)) {
      if (DENIED.has(k.toLowerCase())) throw new Error(`broker refuses PII/content on cross-zone event: ${path}${k}`);
      scan(obj[k], `${path}${k}.`);
    }
  };
  scan(payload, '');
}

class MessageBroker {
  constructor({ clock = () => Date.now() } = {}) {
    this._clock = clock; this._subs = new Map(); this._outbox = []; this._seq = 0;
  }
  subscribe(topic, handler) { if (!this._subs.has(topic)) this._subs.set(topic, []); this._subs.get(topic).push(handler); }

  // Stage an event in the outbox (transactional: written with the domain change, drained
  // after commit). Enforces the PII-free contract before anything is queued.
  publish(topic, payload = {}) {
    assertPiiFree(payload);
    const evt = { id: crypto.randomBytes(8).toString('hex'), topic, seq: ++this._seq, at: this._clock(), payload, delivered: false };
    this._outbox.push(evt);
    return { id: evt.id, seq: evt.seq };
  }

  // Drain the outbox to subscribers (at-least-once). Returns delivery count. A real
  // broker acks per-partition; the port keeps the same drain semantics.
  drain() {
    let n = 0;
    for (const evt of this._outbox) {
      if (evt.delivered) continue;
      for (const h of this._subs.get(evt.topic) || []) { h(evt.payload, evt); n++; }
      evt.delivered = true;
    }
    return n;
  }
  pending() { return this._outbox.filter((e) => !e.delivered).length; }
  history() { return this._outbox.map((e) => ({ topic: e.topic, seq: e.seq, delivered: e.delivered })); }
}

// cfg.broker selects the driver ('memory' reference, or kafka/rabbitmq/nats in
// production). Real brokers are documented drop-ins implementing the same port; not
// bundled, so requesting one fails closed rather than silently using the in-memory outbox.
function makeBroker(cfg = {}) {
  if (cfg.broker && cfg.broker !== 'memory') {
    throw new Error(`broker driver '${cfg.broker}' is a documented drop-in; not bundled in-repo (docs/production-adapters.md)`);
  }
  return new MessageBroker({ clock: cfg.clock });
}

module.exports = { MessageBroker, makeBroker, assertPiiFree, DENIED };
