'use strict';
// Stabilization Parts 6 & 11 — infrastructure governance expansion, DevSecOps finding
// classification, and the quantum migration roadmap.
const test = require('node:test');
const assert = require('node:assert');
const { InfrastructureAssurance, IAC_RULES } = require('../src/infra/infrastructure-assurance');
const { InfrastructureRegistry } = require('../src/infra/infra-governance');
const { CertificateManager } = require('../src/adapters/certificates');
const { QuantumMigrationRegistry } = require('../src/adapters/quantum-transition');
const { makeCryptoAgility } = require('../src/adapters/crypto-agility');
const devsecops = require('../scripts/devsecops');

const NOW = Date.UTC(2026, 7, 1);
function assurance() {
  let now = NOW;
  const registry = new InfrastructureRegistry({ clock: () => now });
  registry.register('compute:app', { kind: 'compute', region: 'bw-central', provider: 'sovereign-cloud' });
  registry.recordBaseline();
  const certificates = new CertificateManager({ clock: () => now });
  certificates.issue({ subject: 'njtip-app' });
  return { ia: new InfrastructureAssurance({ registry, certificates }), registry, certificates };
}

test('IaC validation asserts every declared invariant in the manifests', () => {
  const { ia } = assurance();
  const iac = ia.validateIac();
  assert.strictEqual(iac.valid, true, JSON.stringify(iac.findings));
  assert.strictEqual(iac.rulesChecked, IAC_RULES.length);
  assert.deepStrictEqual(iac.findings, []);
});

test('IaC validation flags unresolved placeholders outside templates', () => {
  const { ia } = assurance();
  const iac = ia.validateIac();
  // The reference manifests deliberately carry REGISTRY/ — the detector must see it.
  assert.ok(iac.unresolvedPlaceholders.includes('deployment.yaml'));
  // The secret example is a template: placeholders there are expected, not findings.
  assert.ok(iac.templates.includes('secret.example.yaml'));
  assert.ok(!iac.unresolvedPlaceholders.includes('secret.example.yaml'));
});

test('SBOM and dependency inventory record a built-ins-only supply chain', () => {
  const { ia } = assurance();
  const inv = ia.dependencyInventory();
  assert.strictEqual(inv.thirdPartyCount, 0);
  assert.deepStrictEqual(inv.transitive, []);
  assert.ok(inv.builtinsUsed.includes('crypto'));
  assert.ok(inv.engines.node);
  assert.strictEqual(ia.sbom().runtime, 'node-builtins-only');
});

test('certificate lifecycle tracks rotation and revocation', () => {
  const { ia, certificates } = assurance();
  const before = ia.certificateLifecycle();
  assert.strictEqual(before.healthy, true);
  assert.strictEqual(before.total, 1);
  const serial = before.inventory[0].serial;
  certificates.revoke(serial, 'key-compromise');
  assert.ok(ia.certificateLifecycle().revoked.includes(serial));
});

test('backup verification requires a restore that reproduces the source', () => {
  const { ia } = assurance();
  const ok = ia.verifyBackup();
  assert.strictEqual(ok.verified, true);
  assert.strictEqual(ok.sourceDigest, ok.restoredDigest);
  assert.strictEqual(ok.restored, ok.records);
});

test('drift detection notices an unreviewed resource change', () => {
  const { ia, registry } = assurance();
  assert.strictEqual(ia.detectDrift().drift, false);
  registry.register('compute:rogue', { kind: 'compute', region: 'bw-south', provider: 'sovereign-cloud' });
  assert.strictEqual(ia.detectDrift().drift, true);
});

test('platform lifecycle detects unsupported and approaching-EOL components', () => {
  const { ia } = assurance();
  assert.strictEqual(ia.detectUnsupported({ now: NOW }).clean, true);
  const future = ia.detectUnsupported({ now: Date.UTC(2035, 0, 1) });
  assert.strictEqual(future.clean, false);
  assert.ok(future.unsupported.length >= 3);
  assert.ok(ia.platformLifecycle({ now: NOW }).components.every((c) => c.status === 'supported'));
});

test('infrastructure assurance report is advisory and never authorizes', () => {
  const { ia } = assurance();
  const rep = ia.report({ now: NOW });
  assert.strictEqual(rep.healthy, true);
  assert.strictEqual(rep.humanGate, true);
  assert.strictEqual(rep.authorizes, false);
  assert.match(rep.note, /human-approved/);
});

test('DevSecOps classifies credentials, identifiers, labels and configuration', () => {
  const cases = [
    ['xK9$mQ2vLp7RtZ4wB3nH', 'password', 'credential'],
    ['this is my actual passphrase', 'password', 'credential'],
    ['bw-central', 'secret', 'identifier'],
    ['restricted', 'classification', 'classification'],
    ['secret', 'classification', 'classification'],
    ['https://idp.example.gov.bw/', 'oidcIssuer', 'configuration'],
    ['REPLACE_FROM_SECRETS_MANAGER', 'password', 'configuration'],
    ['SYNTHETIC-SESSION-SIGNING-KEY-do-not-use-in-prod', 'secret', 'configuration'],
  ];
  for (const [value, key, expected] of cases) assert.strictEqual(devsecops.classifyValue(value, { key }), expected, value);
  assert.ok(devsecops.entropy('xK9$mQ2vLp7RtZ4wB3nH') > devsecops.entropy('bw-central'));
});

test('DevSecOps records suppressed candidates instead of hiding them', () => {
  const rep = devsecops.classificationReport();
  assert.ok(Array.isArray(rep.suppressed));
  assert.strictEqual(rep.candidates, rep.suppressed.length + devsecops.secretScan().length);
  // The data-residency rule is an identifier, not a credential — and it is visible.
  assert.ok(rep.suppressed.some((s) => s.classification === 'identifier'));
  assert.deepStrictEqual(devsecops.secretScan(), [], 'no real credentials in the source tree');
});

test('quantum: algorithm selection stays inside the crypto policy registry', () => {
  const q = new QuantumMigrationRegistry();
  const ind = q.algorithmIndependence();
  assert.strictEqual(ind.independent, true, JSON.stringify(ind.leaks));
  assert.deepStrictEqual(ind.leaks, []);
  assert.ok(ind.allowed.includes('adapters/crypto-agility.js'));
});

test('quantum: the transition plan documents assumptions, requirements and layers', () => {
  const q = new QuantumMigrationRegistry();
  const plan = q.transitionPlan();
  assert.ok(plan.assumptions.some((a) => a.id === 'harvest-now-decrypt-later'));
  assert.ok(plan.assumptions.some((a) => a.id === 'standards-may-change'));
  assert.ok(plan.compatibilityRequirements.length >= 4);
  assert.ok(plan.abstractionLayers.some((l) => /never leaves the HSM/.test(l.neverKnows)));
  assert.strictEqual(plan.phases.length, 4);
  for (const ph of plan.phases) { assert.ok(ph.intent); assert.ok(ph.exitCriterion); }
  assert.strictEqual(plan.humanGate, true);
  assert.strictEqual(plan.authorizes, false);
});

test('quantum: hybrid is mandatory and a non-PQ target is refused', () => {
  const agility = makeCryptoAgility();
  const q = new QuantumMigrationRegistry({ cryptoRegistry: agility.registry });
  const classical = agility.registry.permitted('signature');
  assert.throws(() => q.plan('bad', { purpose: 'signature', fromAlgo: classical[0], toAlgo: classical[1] }), /refused/);
  const pq = agility.registry.catalog('signature').find((a) => a.pq).id;
  q.plan('sig', { purpose: 'signature', fromAlgo: classical[0], toAlgo: pq });
  q.advance('sig'); // assess → hybrid-deploy
  assert.throws(() => q.advance('sig'), /hybrid verification/);
  q.markHybridTested('sig');
  assert.strictEqual(q.advance('sig').phase, 'migrate');
  assert.strictEqual(q.readiness('sig').humanGate, true);
});

test('quantum: the overlap window keeps legacy-signed artifacts verifiable', () => {
  const agility = makeCryptoAgility();
  const provider = agility.provider('signature');
  const legacy = provider.primary();
  const pq = agility.registry.catalog('signature').find((a) => a.pq).id;
  provider.migrate(pq);
  assert.strictEqual(provider.primary(), pq);
  assert.ok(provider.accepts(legacy), 'legacy artifacts must stay verifiable during migration');
});
