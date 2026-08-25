'use strict';
// External-integration PORT — secure, ISOLATED outbound integrations behind stable
// contracts (government identity services, document management, notification gateways,
// SIEM/logging platforms, archival, enterprise messaging). Each integration is wrapped in
// a CIRCUIT BREAKER so a failing/slow dependency cannot cascade into the platform
// (bulkhead + fail-fast). Reference clients are in-memory; production clients implement the
// same call() contract against the real endpoint (docs/production-adapters.md).
//
// OUTBOUND PII-FREE INVARIANT (fail-closed): payloads leaving the platform to an external
// system carry NO identity and NO case content — enforced here, independently checked by an
// app fitness function. (Identity does not exist in the domain; content never leaves a zone.)
const { assertPiiFree } = require('./broker');

// Circuit breaker: closed → (failures ≥ threshold) → open → (after cooldown) half-open →
// success ⇒ closed, failure ⇒ open. Deterministic with an injected clock.
class CircuitBreaker {
  constructor({ clock = () => Date.now(), failureThreshold = 3, cooldownMs = 30_000 } = {}) {
    this._clock = clock; this._threshold = failureThreshold; this._cooldown = cooldownMs;
    this._state = 'closed'; this._failures = 0; this._openedAt = 0;
  }
  state() {
    if (this._state === 'open' && this._clock() - this._openedAt >= this._cooldown) this._state = 'half-open';
    return this._state;
  }
  // Synchronous by design (deterministic reference + synchronous fitness gate). A production
  // client whose send() is async wraps the SAME state machine with await — identical logic,
  // only the call site changes (docs/production-adapters.md).
  call(fn) {
    const s = this.state();
    if (s === 'open') { const e = new Error('circuit-open'); e.circuitOpen = true; throw e; }
    try {
      const out = fn();
      this._failures = 0; this._state = 'closed'; // success closes (incl. from half-open)
      return out;
    } catch (e) {
      this._failures++;
      if (s === 'half-open' || this._failures >= this._threshold) { this._state = 'open'; this._openedAt = this._clock(); }
      throw e;
    }
  }
}

// One integration = a named contract + a client with send(payload). The gateway enforces
// PII-free outbound and wraps every call in the integration's own breaker (isolation).
class IntegrationGateway {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._integrations = new Map(); }
  register(name, client, opts = {}) { this._integrations.set(name, { client, breaker: new CircuitBreaker({ clock: this._clock, ...opts }) }); return this; }
  send(name, payload = {}) {
    const it = this._integrations.get(name); if (!it) throw new Error(`unknown integration: ${name}`);
    assertPiiFree(payload); // fail-closed: no identity/content leaves the platform
    return it.breaker.call(() => it.client.send(payload));
  }
  state(name) { const it = this._integrations.get(name); return it ? it.breaker.state() : null; }
  names() { return [...this._integrations.keys()]; }
}

// Reference client that captures outbound messages (assertable in tests). A production
// client (SIEM/DMS/gov-IdP/notification-gateway) implements the same send() over the wire.
class CaptureIntegrationClient {
  constructor({ failTimes = 0 } = {}) { this._sent = []; this._failTimes = failTimes; }
  send(payload) { if (this._failTimes > 0) { this._failTimes--; throw new Error('integration downstream error'); } this._sent.push(payload); return { accepted: true, id: this._sent.length }; }
  sent() { return [...this._sent]; }
}

function makeIntegrationGateway(cfg = {}) { return new IntegrationGateway({ clock: cfg.clock }); }

module.exports = { CircuitBreaker, IntegrationGateway, CaptureIntegrationClient, makeIntegrationGateway };
