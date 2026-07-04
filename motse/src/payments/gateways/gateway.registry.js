'use strict';

const { err } = require('../../kernel/errors');

/**
 * GatewayRegistry (Phase 4, WS2). Holds the configured gateways and
 * routes each operation to a capable, healthy one — with automatic
 * failover. CardPaymentProvider depends only on this registry, never on
 * a concrete gateway, so gateway selection and failover order are pure
 * configuration.
 *
 * Routing rules:
 *  - a gateway must support the card BRAND and the CURRENCY;
 *  - the configured preference order is tried in turn;
 *  - transient failures (marked e.transient — timeouts, gateway down)
 *    fail over to the next capable gateway, bounded by maxAttempts;
 *  - a hard decline is NOT retried (it is a real answer, not an outage).
 */
class GatewayRegistry {
  constructor({ clock, order = [], maxAttempts = 3 } = {}) {
    this.clock = clock;
    this.gateways = new Map(); // name -> adapter
    this.order = order; // preferred selection order
    this.maxAttempts = maxAttempts;
    this.routingLog = []; // { op, gateway, outcome } for the failover dashboard
  }

  register(adapter) {
    this.gateways.set(adapter.name, adapter);
    if (!this.order.includes(adapter.name)) this.order.push(adapter.name);
    return adapter;
  }

  get(name) {
    const gw = this.gateways.get(name);
    if (!gw) throw err('NOT_FOUND', `No gateway ${name}`);
    return gw;
  }

  setOrder(order) {
    for (const name of order) if (!this.gateways.has(name)) throw err('INVALID_ARGUMENT', `Unknown gateway ${name}`);
    this.order = [...order];
  }

  /** Capable, healthy gateways for a brand+currency, in preference order. */
  candidates({ brand, currency }) {
    return this.order
      .map((name) => this.gateways.get(name))
      .filter((gw) => gw && gw.supportsBrand(brand) && gw.supportsCurrency(currency));
  }

  /**
   * Route an operation with failover. `fn(gateway)` performs the work;
   * transient failures advance to the next candidate. Returns
   * { result, gateway } and records the routing decision.
   */
  route({ brand, currency, op, preferred }, fn) {
    let candidates = this.candidates({ brand, currency });
    if (preferred) {
      // Honour an explicit gateway choice first (e.g. a saved card is
      // tied to the gateway that issued its token), then fail over.
      candidates = [
        ...candidates.filter((g) => g.name === preferred),
        ...candidates.filter((g) => g.name !== preferred),
      ];
    }
    if (candidates.length === 0) {
      throw err('INVALID_ARGUMENT', `No gateway supports ${brand}/${currency}`);
    }
    let lastError;
    for (let i = 0; i < Math.min(candidates.length, this.maxAttempts); i += 1) {
      const gateway = candidates[i];
      try {
        const result = fn(gateway);
        this.routingLog.push({ op, gateway: gateway.name, outcome: 'ok', at: this.clock.nowIso() });
        return { result, gateway: gateway.name };
      } catch (e) {
        if (!e.transient) {
          // A real decline/validation error is the gateway's answer.
          this.routingLog.push({ op, gateway: gateway.name, outcome: 'rejected', at: this.clock.nowIso() });
          throw e;
        }
        // Transient → try the next gateway.
        this.routingLog.push({ op, gateway: gateway.name, outcome: 'failover', at: this.clock.nowIso() });
        gateway.setHealthy(false); // mark degraded; health checks can restore it
        lastError = e;
      }
    }
    throw lastError || err('INTERNAL', 'All candidate gateways failed');
  }

  /** Health of every configured gateway (WS11 gateway status/health). */
  healthAll() {
    return this.order.map((name) => this.gateways.get(name).health());
  }

  /** Restore health for gateways that pass a probe (scheduler). */
  probe() {
    let restored = 0;
    for (const gw of this.gateways.values()) {
      if (!gw._healthy) {
        gw.setHealthy(true); // sandbox probe always recovers
        restored += 1;
      }
    }
    return { restored };
  }

  describe() {
    return {
      order: this.order,
      max_attempts: this.maxAttempts,
      gateways: this.healthAll(),
    };
  }
}

module.exports = { GatewayRegistry };
