'use strict';

const NOOP_METRICS = { setGauge() {} };

/**
 * Business outcome validation (FINAL Phase 1). Business observability is only
 * trustworthy if it agrees with the AUTHORITATIVE systems of record. This
 * reconciler compares the per-capability business telemetry (value processed
 * and the count of value-bearing events) against the LEDGER — the single
 * source of financial truth — and reports, per capability and overall:
 *
 *   - telemetry accuracy   (do the event counts match the ledger?)
 *   - financial accuracy   (do the money totals match the ledger?)
 *   - customer-impact accuracy (is reported customer reach complete given
 *                               how completely events were captured?)
 *   - missing / duplicate events
 *   - reconciliation success rate
 *   - a composite data-confidence score
 *
 * Every discrepancy carries a PROBABLE ROOT CAUSE, the affected capability and
 * customers, the financial exposure, the operational impact, a confidence, and
 * a remediation — so it is actionable, not just a number.
 *
 * Read-only over business observability and the ledger's own collections; it
 * computes and reports, it changes nothing. The ledger is authoritative by
 * construction (double-entry, idempotent), so any gap is a telemetry defect —
 * never a reason to distrust the money.
 *
 * Authoritative sources per capability (all already recorded by the platform):
 *   - fundraising: `escrow_fund` postings on `campaign:` refs (kgetsi giving)
 *   - payouts    : settled rows in `ledger.payouts`
 *   - payments   : `provider_deposit` postings on `card:` refs (card captures)
 */
class BusinessReconciliation {
  constructor({ business, ledger, clock, metrics = null, tolerance = 0 } = {}) {
    this.business = business;
    this.ledger = ledger;
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.metrics = metrics || NOOP_METRICS;
    // Money is exact (integer minor units), so the default tolerance is zero:
    // a single-thebe gap is a real discrepancy worth surfacing.
    this.tolerance = tolerance;
  }

  /** Authoritative tallies straight from the ledger's own records. */
  _authoritative() {
    const postings = this.ledger.postings.find();
    const fundraising = sumPositive(postings, (p) => p.purpose === 'escrow_fund' && startsWith(p.ref, 'campaign:'));
    const payments = sumPositive(postings, (p) => p.purpose === 'provider_deposit' && startsWith(p.ref, 'card:'));
    const settled = this.ledger.payouts.find((x) => x.state === 'settled');
    return {
      fundraising,
      payments,
      payouts: {
        count: settled.length,
        value_minor: settled.reduce((s, x) => s + (x.amount_minor || 0), 0),
      },
    };
  }

  /**
   * Reconcile every financial capability. Returns per-capability results, the
   * discrepancies (with root cause + remediation), and the aggregate accuracy /
   * confidence scores.
   */
  reconcile() {
    const tele = this.business ? this.business.valueEventCounts() : {};
    const auth = this._authoritative();
    const capabilities = {};
    const discrepancies = [];

    for (const name of Object.keys(auth)) {
      const t = tele[name] || { value_events: 0, value_minor: 0, customers: 0 };
      const a = auth[name];
      const countDelta = t.value_events - a.count;
      const valueDelta = t.value_minor - a.value_minor;
      const countAccuracy = accuracy(countDelta, a.count);
      const valueAccuracy = accuracy(valueDelta, a.value_minor);
      // Missing = the ledger has more than telemetry saw; duplicate = telemetry
      // reported more than the ledger holds (phantom / double-counted events).
      const missingEvents = countDelta < 0 ? -countDelta : 0;
      const duplicateEvents = countDelta > 0 ? countDelta : 0;
      const reconciled = Math.abs(countDelta) <= this.tolerance && Math.abs(valueDelta) <= this.tolerance;

      capabilities[name] = {
        product: productName(name),
        telemetry: { value_events: t.value_events, value_minor: t.value_minor, customers: t.customers },
        authoritative: { count: a.count, value_minor: a.value_minor, source: SOURCE[name] },
        count_delta: countDelta,
        value_delta: valueDelta,
        missing_events: missingEvents,
        duplicate_events: duplicateEvents,
        telemetry_accuracy: round(countAccuracy),
        financial_accuracy: round(valueAccuracy),
        // Customer reach can only be as complete as event capture: if events are
        // missing, distinct-customer counts are under-reported by at least as much.
        customer_impact_accuracy: round(countDelta < 0 ? countAccuracy : 1),
        reconciled,
      };

      if (!reconciled) {
        discrepancies.push(this._diagnose(name, {
          countDelta, valueDelta, authoritative: a, telemetry: t,
        }));
      }
    }

    const authCountTotal = sum(Object.values(auth).map((a) => a.count));
    const authValueTotal = sum(Object.values(auth).map((a) => a.value_minor));
    const caps = Object.values(capabilities);
    const reconciledCount = caps.filter((c) => c.reconciled).length;

    const telemetryAccuracy = weightedMean(caps, (c) => c.telemetry_accuracy, (c) => c.authoritative.count, authCountTotal);
    const financialAccuracy = weightedMean(caps, (c) => c.financial_accuracy, (c) => c.authoritative.value_minor, authValueTotal);
    const customerImpactAccuracy = weightedMean(caps, (c) => c.customer_impact_accuracy, (c) => c.authoritative.count, authCountTotal);
    const reconciliationSuccessRate = reconciledCount / caps.length; // caps is the fixed capability set
    // Data confidence leans hardest on the money matching, then on event capture,
    // then on how many capabilities reconcile clean end-to-end.
    const dataConfidence = 0.5 * financialAccuracy + 0.3 * telemetryAccuracy + 0.2 * reconciliationSuccessRate;

    this.metrics.setGauge('motse_reconciliation_telemetry_accuracy', {}, round(telemetryAccuracy));
    this.metrics.setGauge('motse_reconciliation_financial_accuracy', {}, round(financialAccuracy));
    this.metrics.setGauge('motse_reconciliation_data_confidence', {}, round(dataConfidence));
    this.metrics.setGauge('motse_reconciliation_success_rate', {}, round(reconciliationSuccessRate));
    this.metrics.setGauge('motse_reconciliation_discrepancies', {}, discrepancies.length);

    return {
      at: this.clock.nowIso(),
      telemetry_accuracy: round(telemetryAccuracy),
      financial_accuracy: round(financialAccuracy),
      customer_impact_accuracy: round(customerImpactAccuracy),
      reconciliation_success_rate: round(reconciliationSuccessRate),
      data_confidence: round(dataConfidence),
      total_financial_exposure_minor: sum(discrepancies.map((d) => d.financial_exposure_minor)),
      missing_events: sum(caps.map((c) => c.missing_events)),
      duplicate_events: sum(caps.map((c) => c.duplicate_events)),
      capabilities,
      discrepancies: discrepancies.sort((x, y) => SEVERITY[y.severity] - SEVERITY[x.severity] || y.financial_exposure_minor - x.financial_exposure_minor),
    };
  }

  /**
   * Turn a raw delta into an actionable discrepancy: what went wrong, why (a
   * probable root cause), who is affected, the money exposed, and the fix.
   */
  _diagnose(name, { countDelta, valueDelta, authoritative, telemetry }) {
    const exposure = Math.abs(valueDelta);
    let kind;
    let rootCause;
    let remediation;
    let confidence;
    if (countDelta < 0) {
      kind = 'missing_events';
      rootCause = 'Business telemetry under-counts the ledger: the observability subscriber missed value events — most likely it subscribed after emit (boot ordering), the event schema was not registered, or an in-process delivery was dropped.';
      remediation = 'Verify the capability\'s event schemas are registered before the business-observability subscriber attaches; replay the ledger to rebuild the tally; add a startup assertion that subscriptions precede first publish.';
      confidence = 0.9;
    } else if (countDelta > 0) {
      kind = 'duplicate_events';
      rootCause = 'Business telemetry over-counts the ledger: value events were counted more than once — likely a duplicate subscription or an at-least-once redelivery observed without idempotent de-duplication on the telemetry side.';
      remediation = 'De-duplicate telemetry by event/posting id; confirm the capability has exactly one business-observability subscription per event type.';
      confidence = 0.85;
    } else {
      kind = 'value_mismatch';
      rootCause = 'Event counts match but the summed value differs from the ledger: an amount_minor drift, a currency/units mismatch, or partial-capture accounting on the telemetry side.';
      remediation = 'Reconcile the amount fields on the affected events against their postings; confirm all amounts are integer minor units in the ledger currency.';
      confidence = 0.8;
    }
    const severity = exposure > 0 ? (exposure >= 100000 ? 'critical' : 'high') : 'medium';
    return {
      id: `recon-${name}-${kind}`,
      capability: name,
      product: productName(name),
      kind,
      severity,
      probable_root_cause: rootCause,
      affected_capability: name,
      affected_customers: telemetry.customers,
      count_delta: countDelta,
      value_delta_minor: valueDelta,
      financial_exposure_minor: exposure,
      authoritative_source: SOURCE[name],
      operational_impact: kind === 'value_mismatch'
        ? `${productName(name)} dashboards report a value that disagrees with the ledger by ${exposure} minor — business reporting is unreliable until reconciled.`
        : `${productName(name)} event stream is ${kind === 'missing_events' ? 'incomplete' : 'inflated'} by ${Math.abs(countDelta)} event(s) — SLA, customer-reach and value figures for this capability are unreliable.`,
      business_impact: exposure > 0
        ? `Up to ${exposure} minor of activity is mis-reported for ${productName(name)}, affecting up to ${telemetry.customers} reported customers.`
        : `${productName(name)} activity counts are mis-reported (no direct value exposure).`,
      confidence,
      remediation,
      evidence: {
        telemetry_value_events: telemetry.value_events,
        authoritative_count: authoritative.count,
        telemetry_value_minor: telemetry.value_minor,
        authoritative_value_minor: authoritative.value_minor,
      },
      evidence_at: this.clock.nowIso(),
    };
  }
}

const SOURCE = {
  fundraising: "ledger escrow_fund postings on 'campaign:' refs",
  payouts: 'ledger.payouts (state=settled)',
  payments: "ledger provider_deposit postings on 'card:' refs",
};
const PRODUCTS = { fundraising: 'Kgetsi Campaigns', payouts: 'Disbursements', payments: 'Wallet & Payments' };
const SEVERITY = { critical: 4, high: 3, medium: 2, low: 1 };

function productName(name) { return PRODUCTS[name]; } // name is always in the fixed capability set
function startsWith(v, prefix) { return typeof v === 'string' && v.startsWith(prefix); }

/** Count matching postings and sum their positive (credit) legs. */
function sumPositive(postings, predicate) {
  let count = 0;
  let value = 0;
  for (const p of postings) {
    if (!predicate(p)) continue;
    count += 1;
    for (const e of p.entries) if (e.amount_minor > 0) value += e.amount_minor;
  }
  return { count, value_minor: value };
}

/** 1 - |delta|/base, floored at 0; a zero base with a zero delta is perfect. */
function accuracy(delta, base) {
  const b = Math.abs(base);
  if (b === 0) return delta === 0 ? 1 : 0;
  return Math.max(0, 1 - Math.abs(delta) / b);
}

function weightedMean(items, valueFn, weightFn, weightTotal) {
  // No weights (all-zero authoritative base) → plain mean over the fixed set.
  if (!weightTotal) return sum(items.map(valueFn)) / items.length;
  let acc = 0;
  for (const it of items) acc += valueFn(it) * weightFn(it);
  return acc / weightTotal;
}

function sum(xs) { return xs.reduce((a, b) => a + b, 0); }
function round(n) { return Math.round(Number(n) * 10000) / 10000; }

module.exports = { BusinessReconciliation };
