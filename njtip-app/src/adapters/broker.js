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
  constructor({ clock = () => Date.now(), retry = {} } = {}) {
    this._clock = clock; this._subs = new Map(); this._outbox = []; this._seq = 0;
    // Retry policy: bounded attempts with (capped) exponential backoff; on exhaustion the
    // event is dead-lettered rather than retried forever (poison-message protection).
    this._retry = { maxAttempts: retry.maxAttempts ?? 3, baseBackoffMs: retry.baseBackoffMs ?? 1000, maxBackoffMs: retry.maxBackoffMs ?? 60_000 };
    this._dlq = [];
  }
  subscribe(topic, handler) { if (!this._subs.has(topic)) this._subs.set(topic, []); this._subs.get(topic).push(handler); }

  // Stage an event in the outbox (transactional: written with the domain change, drained
  // after commit). Enforces the PII-free contract before anything is queued.
  publish(topic, payload = {}) {
    assertPiiFree(payload);
    const evt = { id: crypto.randomBytes(8).toString('hex'), topic, seq: ++this._seq, at: this._clock(), payload, delivered: false, attempts: 0, nextAttemptAt: this._clock(), lastError: null, deadLettered: false };
    this._outbox.push(evt);
    return { id: evt.id, seq: evt.seq };
  }

  _backoff(attempts) { return Math.min(this._retry.maxBackoffMs, this._retry.baseBackoffMs * Math.pow(2, attempts - 1)); }

  // Drain the outbox to subscribers (at-least-once). Handlers that THROW cause the event to
  // be retried after a backoff; after maxAttempts it is moved to the dead-letter queue.
  // Returns the number of successful handler deliveries. Handlers must be idempotent.
  drain() {
    const now = this._clock();
    let delivered = 0;
    for (const evt of this._outbox) {
      if (evt.delivered || evt.deadLettered) continue;
      if (evt.nextAttemptAt > now) continue; // still backing off
      evt.attempts++;
      try {
        for (const h of this._subs.get(evt.topic) || []) { h(evt.payload, evt); delivered++; }
        evt.delivered = true; evt.lastError = null;
      } catch (e) {
        evt.lastError = e.message;
        if (evt.attempts >= this._retry.maxAttempts) { evt.deadLettered = true; this._dlq.push(evt); }
        else { evt.nextAttemptAt = now + this._backoff(evt.attempts); }
      }
    }
    return delivered;
  }
  pending() { return this._outbox.filter((e) => !e.delivered && !e.deadLettered).length; }
  deadLetters() { return this._dlq.map((e) => ({ id: e.id, topic: e.topic, seq: e.seq, attempts: e.attempts, lastError: e.lastError })); }
  // Operator action: requeue dead-lettered events for another bounded round of attempts.
  replayDeadLetters() {
    const n = this._dlq.length;
    for (const evt of this._dlq) { evt.deadLettered = false; evt.attempts = 0; evt.nextAttemptAt = this._clock(); }
    this._dlq = [];
    return n;
  }
  history() { return this._outbox.map((e) => ({ topic: e.topic, seq: e.seq, delivered: e.delivered, attempts: e.attempts, deadLettered: e.deadLettered })); }
}

// cfg.broker selects the driver ('memory' reference, or kafka/rabbitmq/nats in
// production). Real brokers are documented drop-ins implementing the same port; not
// bundled, so requesting one fails closed rather than silently using the in-memory outbox.
function makeBroker(cfg = {}) {
  if (cfg.broker && cfg.broker !== 'memory') {
    throw new Error(`broker driver '${cfg.broker}' is a documented drop-in; not bundled in-repo (docs/production-adapters.md)`);
  }
  return new MessageBroker({ clock: cfg.clock, retry: cfg.brokerRetry });
}

module.exports = { MessageBroker, makeBroker, assertPiiFree, DENIED };
