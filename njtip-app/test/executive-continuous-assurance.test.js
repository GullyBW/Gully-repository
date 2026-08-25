'use strict';
// Phase 10, Parts 14 & 15 — the evidence-traced executive dashboard and the continuous
// assurance framework.
const test = require('node:test');
const assert = require('node:assert');
const exec = require('../src/observability/executive');
const ca = require('../src/assurance/continuous');
const { createApp } = require('../src/app');

const GOOD = {
  fitness: { allHold: true, heldRatio: 1, failingCount: 0 }, architecture: { valid: true, contexts: 30, modules: 120 },
  security: { policiesCertified: true, credentialFindings: 0, algorithmIndependence: true, postureScore: 1 },
  privacy: { identityMinimized: true, correlationDefaultDeny: true }, compliance: { overallCoverage: 1 },
  reliability: { allSlosMet: true, latencyP95Ms: 100 }, operations: { readinessScore: 1 },
  governance: { ownershipComplete: true, noSelfApproval: true, maturityLevel: 5 },
  recovery: { allScenariosMatch: true, backupVerified: true }, supplyChain: { thirdPartyCount: 0, attestationsVerified: true },
  infrastructure: { healthy: true, drift: false }, legislation: { unimplementedMandates: 0, mandatesImplementedRatio: 1 },
  identity: { trustedIssuer: true, shortLivedCredentials: true }, policies: { certified: true, allSpecsProven: true, specsProven: 10 },
  observability: { topologyValid: true, identityFree: true }, data: { tracedRatio: 1 },
  ai: { allArtifactsApproved: true, noAutonomousAction: true }, risk: { totalExposure: 0, residual: [] },
  assurance: { allDomainsPass: true },
};

// --- Part 14: executive dashboard --------------------------------------------------------------

test('executive: all twelve required metrics exist, each with an evidence path and a control', () => {
  assert.deepStrictEqual(exec.validate().violations, []);
  for (const required of ['architecture-health', 'security-posture', 'compliance-posture', 'reliability', 'performance', 'operational-readiness', 'technical-debt', 'deployment-readiness', 'risk-exposure', 'legislative-readiness', 'data-governance', 'recovery-readiness']) {
    assert.ok(exec.METRICS[required], required);
  }
  for (const t of exec.evidenceTrace()) { assert.ok(t.evidencePath, t.metric); assert.ok(t.verifyingControl, t.metric); assert.match(t.question, /\?/, t.metric); }
});

test('executive: a metric with no evidence is unavailable — never zero, never estimated', () => {
  const empty = exec.dashboard({});
  assert.strictEqual(empty.coverage, 0);
  assert.strictEqual(empty.unavailable.length, Object.keys(exec.METRICS).length);
  for (const m of empty.metrics) {
    assert.strictEqual(m.status, 'unavailable');
    assert.strictEqual(m.value, null);
    assert.ok(m.missingEvidence, m.metric);
  }
});

test('executive: targets are evaluated in the declared direction', () => {
  const full = exec.dashboard(GOOD);
  assert.strictEqual(full.coverage, 1);
  assert.strictEqual(full.healthy, true);
  assert.strictEqual(full.metrics.find((m) => m.metric === 'performance').meets, true);
  const slow = exec.dashboard({ ...GOOD, reliability: { allSlosMet: true, latencyP95Ms: 5000 } });
  assert.strictEqual(slow.metrics.find((m) => m.metric === 'performance').meets, false);
  assert.strictEqual(slow.healthy, false);
  const debt = exec.dashboard({ ...GOOD, fitness: { heldRatio: 0.9, failingCount: 3 } });
  assert.strictEqual(debt.metrics.find((m) => m.metric === 'technical-debt').meets, false);
});

test('executive: the risk heat map bands exposure and is clean when nothing is exposed', () => {
  const heat = exec.riskHeatmap({ residual: [{ threat: 'TH-DEANON', severity: 'critical', exposure: 12, failing: ['FIT-IDENTITY-MINIMIZATION'] }, { threat: 'TH-AVAILABILITY', severity: 'high', exposure: 3 }] });
  assert.strictEqual(heat.worst.threat, 'TH-DEANON');
  assert.strictEqual(heat.worst.band, 'critical');
  assert.strictEqual(heat.byBand.critical, 1);
  assert.strictEqual(exec.riskHeatmap({ residual: [] }).clean, true);
});

test('executive: the dashboard is deterministic, informational and never authorizes', () => {
  assert.deepStrictEqual(exec.dashboard(GOOD), exec.dashboard(GOOD));
  const d = exec.dashboard(GOOD);
  assert.strictEqual(d.informationalOnly, true);
  assert.strictEqual(d.authorizes, false);
});

// --- Part 15: continuous assurance ---------------------------------------------------------------

test('continuous assurance: sixteen domains, each naming real controls and evidence sources', () => {
  assert.deepStrictEqual(ca.validate().violations, []);
  assert.strictEqual(ca.domainIds().length, 16);
  for (const required of ['architecture', 'security', 'privacy', 'compliance', 'performance', 'reliability', 'governance', 'recovery', 'supplyChain', 'infrastructure', 'legislation', 'identity', 'policies', 'observability', 'dataGovernance', 'aiGovernance']) {
    assert.ok(ca.DOMAINS[required], required);
    assert.ok(ca.DOMAINS[required].controls.length >= 1, required);
    assert.ok(ca.DOMAINS[required].reads.length >= 1, required);
  }
});

test('continuous assurance: a domain with no evidence fails rather than passing blind', () => {
  const blind = ca.evaluate({});
  assert.strictEqual(blind.allPass, false);
  assert.strictEqual(blind.passed, 0);
  for (const d of blind.domains) { assert.strictEqual(d.pass, false); assert.match(d.reason, /cannot be assured blind/); }
});

test('continuous assurance: a fully evidenced healthy platform passes every domain', () => {
  const clean = ca.evaluate(GOOD);
  assert.strictEqual(clean.allPass, true, JSON.stringify(clean.failed));
  assert.strictEqual(ca.readinessScore(clean).score, 1);
  assert.strictEqual(ca.readinessScore(clean).band, 'fully assured');
  assert.strictEqual(ca.readinessScore(clean).authorizes, false);
});

test('continuous assurance: one failed domain blocks the package, fail-closed', () => {
  const pkg = ca.deploymentAuthorizationPackage({ sources: { ...GOOD, privacy: { identityMinimized: false, correlationDefaultDeny: true } } });
  assert.strictEqual(pkg.clean, false);
  assert.strictEqual(pkg.failClosed, true);
  assert.ok(pkg.blockers.length >= 1);
  assert.match(pkg.gateOutcome, /BLOCKED/);
  assert.ok(pkg.riskRegister.register.some((r) => r.severity === 'critical'));
});

test('continuous assurance: risk acceptance is recorded and is not authorization', () => {
  const accepted = ca.deploymentAuthorizationPackage({
    sources: { ...GOOD, privacy: { identityMinimized: false, correlationDefaultDeny: true } },
    riskAcceptedBy: 'Oversight Board', riskRationale: 'documented compensating control',
  });
  assert.strictEqual(accepted.riskAcceptance.by, 'Oversight Board');
  assert.match(accepted.gateOutcome, /risk accepted/);
  assert.strictEqual(accepted.authorized, false, 'accepting risk is not authorizing deployment');
});

test('continuous assurance: even a green, signed package authorizes nothing', () => {
  const green = ca.deploymentAuthorizationPackage({ sources: GOOD, mandates: [{ instrument: 'dpa', control: 'FIT-IDENTITY-MINIMIZATION', implemented: true, holding: true }] });
  assert.strictEqual(green.clean, true);
  assert.match(green.gateOutcome, /ALL ASSURANCE GATES PASS/);
  assert.strictEqual(green.authorized, false);
  assert.match(green.authorizationDecision, /NOT AUTHORIZED/);
  assert.ok(green.digest && green.signature);
  assert.strictEqual(green.digest, ca.deploymentAuthorizationPackage({ sources: GOOD, mandates: [{ instrument: 'dpa', control: 'FIT-IDENTITY-MINIMIZATION', implemented: true, holding: true }] }).digest);
});

test('continuous assurance: the registers record risk, evidence and compliance', () => {
  const green = ca.deploymentAuthorizationPackage({ sources: GOOD });
  assert.strictEqual(green.evidenceRegister.complete, true);
  assert.strictEqual(green.riskRegister.clean, true);
  const gap = ca.complianceRegister({ mandates: [{ instrument: 'x', control: 'NONE', implemented: false }] });
  assert.strictEqual(gap.gaps, 1);
  assert.strictEqual(gap.compliant, false);
  assert.match(gap.register[0].state, /gap/);
  const breach = ca.complianceRegister({ mandates: [{ instrument: 'x', control: 'C', implemented: true, holding: false }] });
  assert.strictEqual(breach.breaches, 1);
  assert.match(breach.register[0].state, /BREACH/);
});

test('continuous assurance: production readiness keeps the human items visible', () => {
  const prod = ca.productionReadinessPackage({ sources: GOOD });
  assert.strictEqual(prod.productionReady, false);
  assert.ok(prod.outstandingHumanItems >= 5);
  assert.ok(prod.humanItems.some((i) => /cryptography/i.test(i.item)));
  assert.ok(prod.humanItems.some((i) => /governance decision/i.test(i.item)));
  assert.match(prod.note, /necessary and not sufficient/);
});

// --- Integration: the real platform ---------------------------------------------------------------

test('the live platform passes all sixteen assurance domains from real evidence', () => {
  const app = createApp();
  const dash = app.assurance.dashboard();
  assert.strictEqual(dash.total, 16);
  assert.strictEqual(dash.passed, 16, JSON.stringify(dash.domains.filter((d) => !d.pass).map((d) => `${d.domain}: ${d.reason}`)));
  assert.strictEqual(dash.readiness.score, 1);
  assert.strictEqual(dash.authorizes, false);
});

test('the live executive dashboard resolves every metric from real evidence', () => {
  const app = createApp();
  const d = app.assurance.executiveDashboard();
  assert.strictEqual(d.coverage, 1, JSON.stringify(d.unavailable));
  assert.strictEqual(d.healthy, true, JSON.stringify(d.failing));
  assert.strictEqual(d.authorizes, false);
});

test('the live production readiness package remains NOT AUTHORIZED', () => {
  const app = createApp();
  const pkg = app.assurance.productionReadiness();
  assert.strictEqual(pkg.clean, true);
  assert.strictEqual(pkg.authorized, false);
  assert.strictEqual(pkg.productionReady, false);
  assert.match(pkg.authorizationDecision, /NOT AUTHORIZED/);
  assert.strictEqual(pkg.outstandingHumanItems, 6);
});
