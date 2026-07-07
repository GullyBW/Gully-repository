'use strict';

const NOOP_METRICS = { inc() {}, setGauge() {}, observe() {} };

/**
 * Business observability (Phase 1). Correlates the platform's existing
 * technical events with BUSINESS CAPABILITIES, so a technical signal answers:
 * which capability is affected, how many customers, what value is at risk,
 * which workflows are degraded.
 *
 * It subscribes to the domain events the modules already emit (payments,
 * fundraising, heritage, kgotla, workflows, notifications, payouts) and keeps
 * a rolling per-capability tally: success/failure counts, transaction VALUE
 * (from `amount_minor`), distinct customers (from `user_ref`/actor), and an
 * SLA ratio vs a per-capability target. Metrics land in the shared registry
 * (`motse_business_*`) for the executive/operations dashboards.
 *
 * Additive: read-only over the bus; it emits nothing back and cannot affect
 * domain behaviour. Auth/registration counts are DERIVED from HTTP route
 * counters (identity emits no events — not redesigned here).
 */
const CAPABILITIES = {
  payments: {
    product: 'Wallet & Payments',
    success: ['payments.intent.completed', 'card.captured'],
    failure: ['payments.intent.failed', 'payments.webhook.rejected', 'card.chargeback'],
    value: ['card.captured'],
    sla_target: 0.98,
  },
  payouts: {
    product: 'Disbursements',
    success: ['ledger.payout.settled'],
    failure: ['ledger.payout.failed'],
    value: ['ledger.payout.settled'],
    sla_target: 0.99,
  },
  fundraising: {
    product: 'Kgetsi Campaigns',
    success: ['kgetsi.contribution.received', 'kgetsi.milestone.released'],
    failure: [],
    value: ['kgetsi.contribution.received'],
    sla_target: 0.95,
  },
  heritage: {
    product: 'Heritage Archive',
    success: ['heritage.item.published', 'heritage.item.validated'],
    failure: ['heritage.item.withdrawn'],
    value: [],
    sla_target: 0.9,
  },
  civic: {
    product: 'Kgotla Governance',
    success: ['kgotla.notice.published', 'kgotla.alert.published', 'kgotla.letsema.joined'],
    failure: [],
    value: [],
    sla_target: 0.95,
  },
  workflows: {
    product: 'Automated Workflows',
    success: ['workflow.completed'],
    failure: [],
    value: [],
    sla_target: 0.95,
  },
  notifications: {
    product: 'Member Notifications',
    success: ['notification.dispatched'],
    failure: [],
    value: [],
    sla_target: 0.97,
  },
};

class BusinessObservability {
  constructor({ bus, metrics = null, clock, maxCustomers = 10000 } = {}) {
    this.bus = bus;
    this.metrics = metrics || NOOP_METRICS;
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.maxCustomers = maxCustomers;
    this.caps = new Map();
    for (const [name, def] of Object.entries(CAPABILITIES)) {
      this.caps.set(name, {
        name, product: def.product, sla_target: def.sla_target,
        success: 0, failure: 0, value_minor: 0, value_events: 0,
        customers: new Set(), recent_failures: [],
      });
    }
    if (bus) this._subscribe();
  }

  _subscribe() {
    for (const [name, def] of Object.entries(CAPABILITIES)) {
      const valueSet = new Set(def.value);
      for (const type of def.success) {
        this._on(type, (e) => this._record(name, 'success', e, valueSet.has(type)));
      }
      for (const type of def.failure) {
        this._on(type, (e) => this._record(name, 'failure', e, false));
      }
    }
  }

  _on(type, fn) {
    // Only subscribe to schemas the platform actually registered.
    if (this.bus.schemas.has(type)) this.bus.subscribe(type, 'business-observability', fn);
  }

  _record(name, outcome, event, carriesValue) {
    const cap = this.caps.get(name);
    cap[outcome] += 1;
    const data = (event && event.data) || {};
    if (carriesValue && typeof data.amount_minor === 'number') {
      cap.value_minor += data.amount_minor;
      // Count value-bearing events so a reconciler can compare the number of
      // financial events telemetry saw against the authoritative ledger record.
      cap.value_events += 1;
    }
    const customer = data.user_ref || data.contributor_ref || data.actor_ref || event.actor;
    if (customer && cap.customers.size < this.maxCustomers) cap.customers.add(customer);
    if (outcome === 'failure') {
      cap.recent_failures.push({ type: event.type, at: this.clock.nowIso(), data });
      if (cap.recent_failures.length > 50) cap.recent_failures.shift();
    }
    this.metrics.inc('motse_business_events_total', { capability: name, outcome });
    this.metrics.setGauge('motse_business_value_minor', { capability: name }, cap.value_minor);
    this.metrics.setGauge('motse_business_sla', { capability: name }, round(this._sla(cap)));
  }

  _sla(cap) {
    const total = cap.success + cap.failure;
    return total === 0 ? 1 : cap.success / total;
  }

  /** Per-capability KPIs (the raw business tally). */
  snapshot() {
    const out = {};
    for (const cap of this.caps.values()) {
      const total = cap.success + cap.failure;
      out[cap.name] = {
        product: cap.product,
        completed: cap.success,
        failed: cap.failure,
        total,
        value_minor: cap.value_minor,
        value_events: cap.value_events,
        customers: cap.customers.size,
        sla: round(this._sla(cap)),
        sla_target: cap.sla_target,
        sla_met: this._sla(cap) >= cap.sla_target,
      };
    }
    return out;
  }

  /**
   * Per-capability count of VALUE-bearing events telemetry recorded (the events
   * that carry `amount_minor`). A reconciler compares these against the
   * authoritative ledger record to detect missing/duplicate financial events.
   */
  valueEventCounts() {
    const out = {};
    for (const cap of this.caps.values()) {
      out[cap.name] = { value_events: cap.value_events, value_minor: cap.value_minor, customers: cap.customers.size };
    }
    return out;
  }

  /**
   * Business impact of a capability degradation: customers affected, value at
   * risk, which product, recent failure sample — the answer an operator needs
   * when a technical alert fires.
   */
  impactOf(name) {
    const cap = this.caps.get(name);
    if (!cap) return null;
    return {
      capability: name,
      product: cap.product,
      customers_affected: cap.customers.size,
      failures: cap.failure,
      value_at_risk_minor: cap.value_minor,
      sla: round(this._sla(cap)),
      sla_breached: this._sla(cap) < cap.sla_target,
      recent_failures: cap.recent_failures.slice(-5),
    };
  }

  /** Executive view: KPIs, SLA compliance, customer reach, value processed. */
  executiveView() {
    const snap = this.snapshot();
    const caps = Object.values(snap);
    const slaBreaches = caps.filter((c) => c.total > 0 && !c.sla_met);
    return {
      at: this.clock.nowIso(),
      total_value_minor: caps.reduce((s, c) => s + c.value_minor, 0),
      total_business_events: caps.reduce((s, c) => s + c.total, 0),
      customers_reached: caps.reduce((s, c) => s + c.customers, 0),
      capabilities_healthy: caps.filter((c) => c.total === 0 || c.sla_met).length,
      capabilities_total: caps.length,
      sla_breaches: slaBreaches.map((c) => ({ product: c.product, sla: c.sla, target: c.sla_target })),
      by_capability: snap,
    };
  }

  /** Operations view: service health framed by business capability. */
  operationsView() {
    const snap = this.snapshot();
    return {
      at: this.clock.nowIso(),
      services: Object.entries(snap).map(([name, c]) => ({
        capability: name, product: c.product,
        status: c.total === 0 ? 'idle' : c.sla_met ? 'healthy' : 'degraded',
        throughput: c.total, failures: c.failed, sla: c.sla,
      })),
      degraded: Object.entries(snap).filter(([, c]) => c.total > 0 && !c.sla_met).map(([n]) => n),
    };
  }
}

function round(n) { return Math.round(Number(n) * 10000) / 10000; }

module.exports = { BusinessObservability, CAPABILITIES };
