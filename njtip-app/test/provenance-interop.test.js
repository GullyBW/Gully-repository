'use strict';
// v1.6 Phase 43 (data provenance) + Phase 48 (national interoperability).
const { test } = require('node:test');
const assert = require('node:assert');
const { ProvenanceLedger } = require('../src/fabric/provenance');
const { InteroperabilityProfile, SemanticMapping, SharedVocabulary } = require('../src/fabric/interoperability');

test('provenance: end-to-end lineage, roots, traceability, tamper-evidence, DOT', () => {
  let t = 0;
  const pl = new ProvenanceLedger({ clock: () => (t += 1) });
  pl.record({ artifactId: 'raw:reports', kind: 'source' });
  pl.record({ artifactId: 'proj:cases', kind: 'projection', derivedFrom: ['raw:reports'], transform: 'project' });
  pl.record({ artifactId: 'analytics:kpis', kind: 'analytics', derivedFrom: ['proj:cases'], transform: 'aggregate' });
  pl.record({ artifactId: 'report:exec', kind: 'report', derivedFrom: ['analytics:kpis', 'proj:cases'], transform: 'compose' });
  // Trace reaches the originating source.
  assert.ok(pl.trace('report:exec').some((e) => e.from === 'raw:reports'));
  assert.deepStrictEqual(pl.roots('report:exec'), ['raw:reports']);
  assert.strictEqual(pl.verifyTraceable('report:exec', { rootPrefix: 'raw:' }).traceable, true);
  // Tamper-evidence.
  assert.strictEqual(pl.verify().ok, true);
  // Query + visualization.
  assert.strictEqual(pl.query({ kind: 'analytics' }).length, 1);
  assert.ok(pl.toDot('report:exec').includes('digraph provenance'));
});

test('interoperability: profile versioning (backward compatible), exchange validation, certification', () => {
  const io = new InteroperabilityProfile();
  io.register('case-exchange', { canonical: { caseCode: 'string', category: 'string' }, requiredFields: ['caseCode'] });
  // Additive change is allowed.
  io.register('case-exchange', { canonical: { caseCode: 'string', category: 'string', region: 'string' }, requiredFields: ['caseCode'] });
  assert.strictEqual(io.latest('case-exchange').version, 2);
  // Breaking change refused (existing integrations must not break).
  assert.throws(() => io.register('case-exchange', { canonical: { caseCode: 'number' }, requiredFields: ['caseCode'] }), /not backward compatible/);
  // Exchange validation: required field present + typed.
  assert.strictEqual(io.validateExchange('case-exchange', { caseCode: 'NJ-1' }).ok, true);
  assert.strictEqual(io.validateExchange('case-exchange', {}).ok, false);
  assert.strictEqual(io.validateExchange('case-exchange', { caseCode: 42 }).ok, false); // wrong type
  // Conformance + certification.
  const cert = io.certifyExchange('dcec', 'case-exchange', [{ label: 'a', payload: { caseCode: 'NJ-1' } }, { label: 'b', payload: { caseCode: 'NJ-2' } }]);
  assert.strictEqual(cert.certified, true);
  assert.ok(/human governance decision/.test(cert.note));
});

test('interoperability: semantic mapping + shared vocabulary', () => {
  const sm = new SemanticMapping();
  sm.define('agency-x', { complaint_id: 'caseCode', dept: 'recipient' });
  assert.deepStrictEqual(sm.toCanonical('agency-x', { complaint_id: 'NJ-1', dept: 'ombudsman' }), { caseCode: 'NJ-1', recipient: 'ombudsman' });
  const vocab = new SharedVocabulary({ complaint: 'Case' });
  assert.strictEqual(vocab.resolve('complaint'), 'Case');
  assert.strictEqual(vocab.add('exhibit', 'EvidenceRef').resolve('exhibit'), 'EvidenceRef');
});
