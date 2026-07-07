'use strict';

/**
 * FINAL Phase 1 (business outcome validation) + Phase 2 (recommendation
 * effectiveness). Phase 1 reconciles the business telemetry against the LEDGER
 * (the authoritative system of record) — proving the dashboards agree with the
 * money and diagnosing any gap. Phase 2 treats the advisors' recommendations as
 * measurable products (accepted/rejected/outcomes) and recalibrates future
 * confidence from the measured track record.
 */
const request = require('supertest');
const { BusinessReconciliation } = require('../src/observability/business.reconciliation');
const { RecommendationEffectiveness } = require('../src/observability/recommendation.effectiveness');
const { BusinessObservability } = require('../src/observability/business.observability');
const { EventBus } = require('../src/kernel/eventBus');
const { Clock } = require('../src/kernel/clock');
const { Metrics } = require('../src/monitoring/metrics');
const { createPlatform } = require('../src/container');
const { createApp } = require('../src/app');
const { world, liveCampaign } = require('./helpers');

// ── Ledger / business fakes for precise, controlled reconciliation ────
function fakeLedger({ postings = [], payouts = [] } = {}) {
  return {
    postings: { find: (pred = () => true) => postings.filter(pred).map((r) => ({ ...r })) },
    payouts: { find: (pred = () => true) => payouts.filter(pred).map((r) => ({ ...r })) },
  };
}
function fund(ref, amt) {
  return { purpose: 'escrow_fund', ref, entries: [{ account_id: 's', amount_minor: -amt }, { account_id: 'e', amount_minor: amt }] };
}
function cardDep(ref, amt) {
  return { purpose: 'provider_deposit', ref, entries: [{ account_id: 'clr', amount_minor: -amt }, { account_id: 'd', amount_minor: amt }] };
}
function settled(amt) { return { state: 'settled', amount_minor: amt }; }
function fakeBiz(counts) { return { valueEventCounts: () => counts }; }

describe('FINAL P1 · BusinessReconciliation — telemetry vs the authoritative ledger', () => {
  test('perfect match: every capability reconciles, confidence is 1, no discrepancies', () => {
    const metrics = new Metrics();
    const ledger = fakeLedger({
      postings: [fund('campaign:c1', 4000), fund('campaign:c1', 6000), cardDep('card:i1', 8000)],
      payouts: [settled(2500), settled(1500)],
    });
    const business = fakeBiz({
      fundraising: { value_events: 2, value_minor: 10000, customers: 2 },
      payments: { value_events: 1, value_minor: 8000, customers: 1 },
      payouts: { value_events: 2, value_minor: 4000, customers: 0 },
    });
    const recon = new BusinessReconciliation({ business, ledger, clock: new Clock(), metrics }).reconcile();
    expect(recon.data_confidence).toBe(1);
    expect(recon.financial_accuracy).toBe(1);
    expect(recon.telemetry_accuracy).toBe(1);
    expect(recon.customer_impact_accuracy).toBe(1);
    expect(recon.reconciliation_success_rate).toBe(1);
    expect(recon.discrepancies).toEqual([]);
    expect(recon.missing_events).toBe(0);
    expect(recon.duplicate_events).toBe(0);
    // Metrics reached the registry.
    expect(metrics.render()).toContain('motse_reconciliation_financial_accuracy');
    expect(metrics.render()).toContain('motse_reconciliation_data_confidence');
  });

  test('missing events: ledger has more than telemetry saw → under-count diagnosis + exposure', () => {
    const ledger = fakeLedger({
      postings: [fund('campaign:c1', 3000), fund('campaign:c1', 3000), fund('campaign:c1', 3000)],
    });
    // Telemetry saw only 2 of 3 contributions (6000 of 9000).
    const business = fakeBiz({ fundraising: { value_events: 2, value_minor: 6000, customers: 2 } });
    const recon = new BusinessReconciliation({ business, ledger, clock: new Clock() }).reconcile();
    const f = recon.capabilities.fundraising;
    expect(f.count_delta).toBe(-1);
    expect(f.value_delta).toBe(-3000);
    expect(f.missing_events).toBe(1);
    expect(f.duplicate_events).toBe(0);
    expect(f.customer_impact_accuracy).toBeLessThan(1); // missing events under-count customers
    const d = recon.discrepancies.find((x) => x.capability === 'fundraising');
    expect(d.kind).toBe('missing_events');
    expect(d.financial_exposure_minor).toBe(3000);
    expect(d.probable_root_cause).toMatch(/under-counts/i);
    expect(d.remediation).toMatch(/registered before/i);
    expect(d.affected_customers).toBe(2);
    expect(recon.total_financial_exposure_minor).toBe(3000);
  });

  test('duplicate events: telemetry over-counts the ledger → phantom/duplicate diagnosis', () => {
    const ledger = fakeLedger({ payouts: [settled(5000)] });
    const business = fakeBiz({ payouts: { value_events: 2, value_minor: 10000, customers: 0 } });
    const recon = new BusinessReconciliation({ business, ledger, clock: new Clock() }).reconcile();
    const p = recon.capabilities.payouts;
    expect(p.count_delta).toBe(1);
    expect(p.duplicate_events).toBe(1);
    const d = recon.discrepancies.find((x) => x.capability === 'payouts');
    expect(d.kind).toBe('duplicate_events');
    expect(d.probable_root_cause).toMatch(/over-counts/i);
    expect(d.operational_impact).toMatch(/inflated/i);
  });

  test('value mismatch: counts agree but the money disagrees → amount-drift diagnosis', () => {
    const ledger = fakeLedger({ postings: [cardDep('card:i1', 4000), cardDep('card:i2', 4000)] });
    const business = fakeBiz({ payments: { value_events: 2, value_minor: 7999, customers: 2 } });
    const recon = new BusinessReconciliation({ business, ledger, clock: new Clock() }).reconcile();
    const d = recon.discrepancies.find((x) => x.capability === 'payments');
    expect(d.kind).toBe('value_mismatch');
    expect(d.count_delta).toBe(0);
    expect(d.financial_exposure_minor).toBe(1);
    expect(d.operational_impact).toMatch(/disagrees with the ledger/i);
    expect(d.probable_root_cause).toMatch(/amount_minor drift|units mismatch/i);
  });

  test('count differs but value matches (a zero-value phantom) → medium severity, no exposure', () => {
    const ledger = fakeLedger({ payouts: [settled(5000), settled(5000)] });
    // Three telemetry events summing to the same 10000 (one carried zero value).
    const business = fakeBiz({ payouts: { value_events: 3, value_minor: 10000, customers: 0 } });
    const recon = new BusinessReconciliation({ business, ledger, clock: new Clock() }).reconcile();
    const d = recon.discrepancies.find((x) => x.capability === 'payouts');
    expect(d.kind).toBe('duplicate_events');
    expect(d.financial_exposure_minor).toBe(0);
    expect(d.severity).toBe('medium');
    expect(d.business_impact).toMatch(/no direct value exposure/i);
  });

  test('critical severity when the financial exposure is large; discrepancies sort worst-first', () => {
    const ledger = fakeLedger({
      postings: [fund('campaign:c1', 200000)], // fundraising: big exposure (critical)
      payouts: [settled(5000)], // payouts: small count-only exposure
    });
    const business = fakeBiz({
      fundraising: { value_events: 0, value_minor: 0, customers: 0 }, // missed entirely
      payouts: { value_events: 2, value_minor: 5001, customers: 0 }, // small over-count
    });
    const recon = new BusinessReconciliation({ business, ledger, clock: new Clock() }).reconcile();
    expect(recon.discrepancies[0].capability).toBe('fundraising');
    expect(recon.discrepancies[0].severity).toBe('critical');
    expect(recon.discrepancies.length).toBe(2);
  });

  test('authoritative filtering: only escrow_fund/campaign, provider_deposit/card and settled payouts count', () => {
    const ledger = fakeLedger({
      postings: [
        fund('campaign:c1', 4000), // counts (fundraising)
        fund('booking:b1', 9999), // excluded — not a campaign ref
        { purpose: 'escrow_release', ref: 'campaign:c1', entries: [{ account_id: 'e', amount_minor: -4000 }, { account_id: 'd', amount_minor: 4000 }] }, // excluded — release
        { purpose: 'escrow_fund', ref: null, entries: [{ account_id: 's', amount_minor: -1 }, { account_id: 'e', amount_minor: 1 }] }, // excluded — non-string ref
        cardDep('card:i1', 8000), // counts (payments)
        cardDep('topup:w1', 5000), // excluded — provider_deposit but not a card ref
      ],
      payouts: [settled(2500), { state: 'pending', amount_minor: 9999 }], // only the settled one counts
    });
    const business = fakeBiz({
      fundraising: { value_events: 1, value_minor: 4000, customers: 1 },
      payments: { value_events: 1, value_minor: 8000, customers: 1 },
      payouts: { value_events: 1, value_minor: 2500, customers: 0 },
    });
    const recon = new BusinessReconciliation({ business, ledger, clock: new Clock() }).reconcile();
    expect(recon.capabilities.fundraising.authoritative).toMatchObject({ count: 1, value_minor: 4000 });
    expect(recon.capabilities.payments.authoritative).toMatchObject({ count: 1, value_minor: 8000 });
    expect(recon.capabilities.payouts.authoritative).toMatchObject({ count: 1, value_minor: 2500 });
    expect(recon.discrepancies).toEqual([]);
  });

  test('phantom against an empty ledger: zero authoritative base, non-zero telemetry → accuracy 0', () => {
    const ledger = fakeLedger({}); // nothing authoritative
    const business = fakeBiz({ payouts: { value_events: 2, value_minor: 100, customers: 0 } });
    const recon = new BusinessReconciliation({ business, ledger, clock: new Clock() }).reconcile();
    expect(recon.capabilities.payouts.telemetry_accuracy).toBe(0);
    expect(recon.capabilities.payouts.financial_accuracy).toBe(0);
    expect(recon.capabilities.payouts.duplicate_events).toBe(2);
  });

  test('empty everything (no base, no telemetry) uses the plain-mean path and is perfect', () => {
    const recon = new BusinessReconciliation({ business: fakeBiz({}), ledger: fakeLedger({}), clock: new Clock() }).reconcile();
    expect(recon.data_confidence).toBe(1);
    expect(recon.reconciliation_success_rate).toBe(1);
    expect(recon.discrepancies).toEqual([]);
  });

  test('constructs with no business (metrics-only) and defaults its own clock/metrics', () => {
    const recon = new BusinessReconciliation({ ledger: fakeLedger({}) }).reconcile();
    expect(recon.data_confidence).toBe(1);
    expect(recon.capabilities.fundraising.telemetry.value_events).toBe(0);
  });

  test('real platform: contributions + a settled payout reconcile exactly against the ledger', () => {
    const w = world();
    const camp = liveCampaign(w);
    w.p.kgetsi.contribute(camp.id, { sourceAccountId: w.kaboWallet.id, amountMinor: 4000, contributorRef: w.kabo.id, idempotencyKey: 'r1' });
    w.p.kgetsi.contribute(camp.id, { sourceAccountId: w.mmaWallet.id, amountMinor: 6000, contributorRef: w.mma.id, idempotencyKey: 'r2' });
    const payout = w.p.ledger.requestPayout({
      accountId: w.kaboWallet.id, providerAccountId: w.providerClearing.id,
      amountMinor: 2500, msisdnRef: 'm', ref: 'payout:r', idempotencyKey: 'rp1',
    });
    w.p.ledger.settlePayout(payout.id, 'receipt');
    const recon = w.p.reconciliation.reconcile();
    expect(recon.capabilities.fundraising).toMatchObject({ reconciled: true });
    expect(recon.capabilities.fundraising.authoritative.value_minor).toBe(10000);
    expect(recon.capabilities.payouts.authoritative.value_minor).toBe(2500);
    expect(recon.data_confidence).toBe(1);
    expect(recon.discrepancies).toEqual([]);
  });

  test('two discrepancies of equal severity sort by financial exposure (largest first)', () => {
    const ledger = fakeLedger({
      postings: [fund('campaign:c1', 3000), cardDep('card:i1', 5000), cardDep('card:i2', 5000)],
    });
    const business = fakeBiz({
      fundraising: { value_events: 0, value_minor: 0, customers: 0 }, // missing → exposure 3000 (high)
      payments: { value_events: 2, value_minor: 5000, customers: 2 }, // value_mismatch → exposure 5000 (high)
    });
    const recon = new BusinessReconciliation({ business, ledger, clock: new Clock() }).reconcile();
    expect(recon.discrepancies.map((d) => d.severity)).toEqual(['high', 'high']);
    expect(recon.discrepancies[0].capability).toBe('payments'); // larger exposure first
    expect(recon.discrepancies[1].capability).toBe('fundraising');
  });

  test('settled payouts with no amount default to zero; constructs with no args', () => {
    const ledger = fakeLedger({ payouts: [{ state: 'settled' }] }); // amount_minor absent
    const recon = new BusinessReconciliation({ ledger, clock: new Clock() }).reconcile();
    expect(recon.capabilities.payouts.authoritative.value_minor).toBe(0);
    expect(() => new BusinessReconciliation()).not.toThrow(); // no-arg construction is safe
  });

  test('valueEventCounts on the real BusinessObservability tracks value-bearing events', () => {
    const bus = new EventBus(new Clock());
    bus.register('card.captured', 1, ['amount_minor']);
    const biz = new BusinessObservability({ bus, clock: new Clock() });
    bus.publish('card.captured', { amount_minor: 100, user_ref: 'u1' });
    bus.publish('card.captured', { amount_minor: 250, user_ref: 'u2' });
    const counts = biz.valueEventCounts();
    expect(counts.payments).toMatchObject({ value_events: 2, value_minor: 350, customers: 2 });
    expect(biz.snapshot().payments.value_events).toBe(2);
  });
});

describe('FINAL P2 · RecommendationEffectiveness — recommendations as measurable products', () => {
  const clk = () => new Clock();

  test('records generated recommendations, deduping a still-open standing recommendation', () => {
    const re = new RecommendationEffectiveness({ clock: clk() });
    const a = re.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
    const b = re.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
    expect(b.id).toBe(a.id); // same open fingerprint → not double-counted
    expect(re.effectiveness().generated).toBe(1);
    // Once resolved, a new one of the same signal is a fresh product.
    re.accept(a.id, 'op');
    re.resolve(a.id, { success: true });
    const c = re.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
    expect(c.id).not.toBe(a.id);
    expect(re.effectiveness().generated).toBe(2);
  });

  test('ingest skips healthy signals, honours explicit fingerprints, dedupes open items', () => {
    const re = new RecommendationEffectiveness({ clock: clk() });
    const recs = [
      { signal: 'healthy', confidence: 0.9 },
      { signal: 'queue_growth', urgency: 'medium', confidence: 0.7 },
      { signal: 'queue_growth', urgency: 'medium', confidence: 0.7 }, // dup (same fingerprint)
      { signal: 'lock_contention', confidence: 0.6, fingerprint: 'custom:lock' },
    ];
    const out = re.ingest('operational_intelligence', recs);
    expect(out.length).toBe(3); // healthy skipped
    expect(re.effectiveness().generated).toBe(2); // queue_growth deduped
  });

  test('precision, recall, usefulness, trust, ROI and per-signal calibration', () => {
    const re = new RecommendationEffectiveness({ clock: clk() });
    // TP: accepted, prevented an incident with known exposure.
    const g1 = re.record({ source: 'ops', signal: 'dependency_failure', confidence: 0.95 });
    re.accept(g1.id, 'op-1');
    re.resolve(g1.id, { success: true, incident_prevented: true, financial_exposure_minor: 50000 });
    // FP: raised, rejected, turned out not real.
    const g2 = re.record({ source: 'ops', signal: 'retry_storm', confidence: 0.6 });
    re.reject(g2.id, 'op-1', 'transient');
    re.resolve(g2.id, { false_positive: true });
    // FN: a real incident nothing flagged.
    re.recordMiss({ signal: 'disk_full', financial_exposure_minor: 1000 });
    const eff = re.effectiveness();
    expect(eff.outcomes).toMatchObject({ successes: 1, false_positives: 1, false_negatives: 1, incidents_prevented: 1 });
    expect(eff.precision).toBe(0.5); // 1 / (1 + 1)
    expect(eff.recall).toBe(0.5); // 1 / (1 + 1)
    expect(eff.usefulness).toBe(1); // the one accepted-and-resolved succeeded
    expect(eff.operator_trust_score).toBeGreaterThan(0);
    expect(eff.roi.incidents_prevented).toBe(1);
    expect(eff.roi.financial_exposure_prevented_minor).toBe(50000);
    expect(eff.roi.false_alarms).toBe(1);
    expect(eff.roi.net_signal).toBe(0);
    const sig = eff.by_signal.find((s) => s.signal === 'dependency_failure');
    expect(sig.observed_hit_rate).toBe(1);
  });

  test('confidence recalibration shrinks the prior toward the measured hit-rate', () => {
    const re = new RecommendationEffectiveness({ clock: clk(), priorWeight: 3 });
    // Two resolved of the same signal: one success, one false positive → hit-rate 0.5.
    const g1 = re.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
    re.accept(g1.id); re.resolve(g1.id, { success: true });
    const g1b = re.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
    re.resolve(g1b.id, { false_positive: true });
    // (0.8*3 + 0.5*2) / (3+2) = 3.4/5 = 0.68
    expect(re.calibratedConfidence('memory_pressure', 0.8)).toBeCloseTo(0.68, 5);
    const row = re.recalibration().signals.find((s) => s.signal === 'memory_pressure');
    expect(row.calibrated_confidence).toBeCloseTo(0.68, 5);
    expect(row.adjustment).toBeCloseTo(-0.12, 5);
    // A signal with no measured evidence keeps its prior.
    expect(re.calibratedConfidence('never_seen', 0.9)).toBe(0.9);
  });

  test('lifecycle responses record actor, reason and note; resolve handles failure + false positive', () => {
    const re = new RecommendationEffectiveness({ clock: clk() });
    const g = re.record({ source: 'ops', signal: 'circuit_open', confidence: 0.7 });
    const ov = re.override(g.id, 'op-2', 'chose safe mode instead');
    expect(ov).toMatchObject({ status: 'overridden', responded_by: 'op-2', note: 'chose safe mode instead' });
    re.resolve(g.id, { success: false }); // acted on, did not help → failure
    expect(re.effectiveness().outcomes.failures).toBe(1);

    const g2 = re.record({ source: 'ops', signal: 'queue_growth', confidence: 0.7 });
    re.ignore(g2.id);
    expect(re.ledger().find((r) => r.id === g2.id).status).toBe('ignored');
  });

  test('effectiveness is all-nulls on an empty tracker (no fabricated metrics)', () => {
    const re = new RecommendationEffectiveness({ clock: clk() });
    const eff = re.effectiveness();
    expect(eff.generated).toBe(0);
    expect(eff.precision).toBeNull();
    expect(eff.recall).toBeNull();
    expect(eff.acceptance_rate).toBeNull();
    expect(eff.usefulness).toBeNull();
    expect(eff.operator_trust_score).toBeNull();
    expect(eff.roi.prevention_yield).toBeNull();
  });

  test('trust falls back to precision when nothing was decided, and to acceptance when nothing resolved', () => {
    // Only resolved (never "decided" via accept/reject/ignore/override) → trust = precision.
    const re1 = new RecommendationEffectiveness({ clock: clk() });
    const g = re1.record({ source: 'ops', signal: 's1', confidence: 0.7 });
    re1.resolve(g.id, { success: true });
    const e1 = re1.effectiveness();
    expect(e1.acceptance_rate).toBeNull();
    expect(e1.operator_trust_score).toBe(e1.precision);
    expect(e1.usefulness).toBeNull(); // resolved but not accepted → no accepted-resolved sample

    // Only decided (accepted) but never resolved → trust = acceptance_rate.
    const re2 = new RecommendationEffectiveness({ clock: clk() });
    const g2 = re2.record({ source: 'ops', signal: 's2', confidence: 0.7 });
    re2.accept(g2.id, 'op');
    const e2 = re2.effectiveness();
    expect(e2.precision).toBeNull();
    expect(e2.operator_trust_score).toBe(e2.acceptance_rate);
  });

  test('ingestFromPlatform pulls from both advisors and is a no-op when they are absent', () => {
    const re = new RecommendationEffectiveness({ clock: clk() });
    const platform = {
      opsIntel: { advise: () => ({ recommendations: [{ signal: 'memory_pressure', urgency: 'high', confidence: 0.8 }] }) },
      governanceAnalytics: { recommend: () => ({ recommendations: [{ signal: 'healthy', urgency: 'none', confidence: 0.9 }, { signal: 'approval_delay', urgency: 'high', confidence: 0.85 }] }) },
    };
    expect(re.ingestFromPlatform(platform).length).toBe(2); // healthy skipped
    expect(re.ingestFromPlatform({}).length).toBe(0); // neither advisor present
  });

  test('recordMiss makes recall measurable even with no false positives', () => {
    const re = new RecommendationEffectiveness({ clock: clk() });
    const g = re.record({ source: 'ops', signal: 'x', confidence: 0.7 });
    re.accept(g.id); re.resolve(g.id, { success: true });
    re.recordMiss({ signal: 'y' });
    const eff = re.effectiveness();
    expect(eff.precision).toBe(1); // 1 / (1 + 0)
    expect(eff.recall).toBe(0.5); // 1 / (1 + 1)
  });

  test('_must throws for an unknown recommendation id', () => {
    const re = new RecommendationEffectiveness({ clock: clk() });
    expect(() => re.accept('nope')).toThrow(/no record/);
  });

  test('default parameter and edge-branch paths', () => {
    // No-arg construction (own clock, no metrics) + empty ingest.
    const re = new RecommendationEffectiveness();
    expect(re.ingest('ops').length).toBe(0); // recommendations defaults to []
    // record with defaults: no source (→ 'unknown'), no confidence, no urgency; and an explicit `at`.
    const bare = re.record({ signal: 'lonely' });
    expect(bare.source).toBe('unknown');
    expect(bare.stated_confidence).toBeNull();
    expect(bare.urgency).toBe('medium');
    re.record({ source: 's', signal: 'timed', at: '2020-01-01T00:00:00.000Z' });
    // ingest carrying an explicit `at`.
    re.ingest('ops', [{ signal: 'q', confidence: 0.5 }], { at: '2020-01-02T00:00:00.000Z' });
    // Response setters with defaults (no by/note); resolve with no options (→ success).
    re.reject(bare.id); // by/reason default null
    const g = re.record({ source: 's', signal: 'ov' });
    re.override(g.id); // by/note default null
    re.resolve(g.id); // all defaults → success
    expect(re.recs.get(g.id).outcome).toBe('success');
    // recordMiss with no arguments → 'unflagged_incident'.
    expect(re.recordMiss().signal).toBe('unflagged_incident');

    // ROI exposure `|| 0`: a prevented success with no exposure recorded.
    const p = re.record({ source: 's', signal: 'prev' });
    re.accept(p.id); re.resolve(p.id, { success: true, incident_prevented: true });
    expect(re.effectiveness().roi.financial_exposure_prevented_minor).toBe(0);

    // Calibration with a null stated confidence → mean is null, adjustment null.
    const nc = re.record({ source: 's', signal: 'noconf' }); // confidence null
    re.resolve(nc.id, { success: true });
    const row = re.recalibration().signals.find((s) => s.signal === 'noconf');
    expect(row.mean_stated_confidence).toBeNull();
    expect(row.adjustment).toBeNull();

    // calibratedConfidence: prior null but evidence present → returns the observed rate.
    expect(re.calibratedConfidence('noconf', null)).toBe(1); // one success, hit-rate 1
    // calibratedConfidence: no evidence and null prior → returns the (null) prior unchanged.
    expect(re.calibratedConfidence('never', null)).toBeNull();
  });

  test('uses the platform Store when given one (durable, inspectable ledger)', () => {
    const p = createPlatform();
    const g = p.recommendationEffectiveness.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
    p.recommendationEffectiveness.accept(g.id, 'op');
    expect(p.store.collection('recommendation_ledger').get(g.id).status).toBe('accepted');
    expect(p.recommendationEffectiveness.ledger().length).toBeGreaterThanOrEqual(1);
  });
});

describe('FINAL P1+P2 · admin control plane', () => {
  function adminApp() {
    const w = world();
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    const { app } = createApp(w.p);
    const otp = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', otp.sandbox_code, { deviceId: 'dev-kabo' });
    const authed = (r) => r.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'dev-kabo');
    // Seed a recommendation so the lifecycle routes have something to act on.
    w.p.recommendationEffectiveness.record({ source: 'ops', signal: 'memory_pressure', confidence: 0.8 });
    return { w, app, authed };
  }

  test('GET /v1/admin/reconciliation returns the reconciliation report', async () => {
    const { app, authed } = adminApp();
    const res = await authed(request(app).get('/v1/admin/reconciliation'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data_confidence');
    expect(res.body).toHaveProperty('capabilities.fundraising');
  });

  test('GET /v1/admin/recommendations/effectiveness + calibration + ledger', async () => {
    const { app, authed } = adminApp();
    const eff = await authed(request(app).get('/v1/admin/recommendations/effectiveness'));
    expect(eff.status).toBe(200);
    expect(eff.body).toHaveProperty('generated');
    const cal = await authed(request(app).get('/v1/admin/recommendations/calibration'));
    expect(cal.status).toBe(200);
    expect(cal.body).toHaveProperty('signals');
    const led = await authed(request(app).get('/v1/admin/recommendations/ledger'));
    expect(led.status).toBe(200);
    expect(Array.isArray(led.body)).toBe(true);
  });

  let idemSeq = 0;
  const idem = () => `recff-${idemSeq += 1}`;

  test('recommendation lifecycle over the admin API (ledger → accept → resolve), plus ingest', async () => {
    const { app, authed } = adminApp();
    const led = await authed(request(app).get('/v1/admin/recommendations/ledger'));
    const rec = led.body.find((r) => r.status === 'generated');
    const acc = await authed(request(app).post(`/v1/admin/recommendations/${rec.id}/accept`)).set('Idempotency-Key', idem());
    expect(acc.status).toBe(200);
    expect(acc.body.status).toBe('accepted');
    const res = await authed(request(app).post(`/v1/admin/recommendations/${rec.id}/resolve`)).set('Idempotency-Key', idem()).send({ success: true, incident_prevented: true });
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('success');
    const ing = await authed(request(app).post('/v1/admin/recommendations/ingest')).set('Idempotency-Key', idem());
    expect(ing.status).toBe(200);
    expect(ing.body).toHaveProperty('ingested');
  });

  test('reject / ignore / override lifecycle routes', async () => {
    const { w, app, authed } = adminApp();
    const r1 = w.p.recommendationEffectiveness.record({ source: 'ops', signal: 'retry_storm', confidence: 0.6 });
    const rej = await authed(request(app).post(`/v1/admin/recommendations/${r1.id}/reject`)).set('Idempotency-Key', idem()).send({ reason: 'transient' });
    expect(rej.body.status).toBe('rejected');
    const r2 = w.p.recommendationEffectiveness.record({ source: 'ops', signal: 'queue_growth', confidence: 0.6 });
    const ign = await authed(request(app).post(`/v1/admin/recommendations/${r2.id}/ignore`)).set('Idempotency-Key', idem());
    expect(ign.body.status).toBe('ignored');
    const r3 = w.p.recommendationEffectiveness.record({ source: 'ops', signal: 'lock_contention', confidence: 0.6 });
    const ov = await authed(request(app).post(`/v1/admin/recommendations/${r3.id}/override`)).set('Idempotency-Key', idem()).send({ note: 'manual' });
    expect(ov.body.status).toBe('overridden');
  });

  test('overview surfaces reconciliation + recommendation effectiveness', async () => {
    const { app, authed } = adminApp();
    const res = await authed(request(app).get('/v1/admin/overview'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('reconciliation.data_confidence');
    expect(res.body).toHaveProperty('recommendation_effectiveness.generated');
    expect(res.body.slo_dashboards).toContain('reconciliation');
  });
});
