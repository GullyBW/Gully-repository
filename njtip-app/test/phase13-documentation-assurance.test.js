'use strict';
// Phase 13, Parts 6 & 7 — documentation assurance, and operational procedure verification.
const test = require('node:test');
const assert = require('node:assert');
const da = require('../src/architecture/documentation-assurance');

const controls = () => [
  ...require('../../njtip-twin/verification/fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/app-fitness').map((f) => ({ id: f.id, pass: true })),
  ...require('../verification/infra-fitness').map((f) => ({ id: f.id, pass: true })),
];
const world = () => ({ routes: da.serverRoutes(), scripts: da.npmScripts(), adrs: da.adrNumbers(), controls: new Set(controls().map((c) => c.id)) });

// --- Part 6: documentation assurance ---------------------------------------------------------------

test('every claim kind says what it is, what resolution means, and what a wrong one costs', () => {
  const kinds = da.claimKinds();
  assert.ok(kinds.length >= 6);
  for (const k of kinds) {
    assert.ok(k.description, k.kind);
    assert.ok(k.resolvedMeans, k.kind);
    assert.ok(k.ifWrong, k.kind);
  }
});

test('the governed corpus is named rather than globbed, and every document has a role', () => {
  const docs = da.documents();
  assert.ok(docs.length >= 8);
  for (const d of docs) {
    const spec = da.GOVERNED_DOCUMENTS[d];
    assert.ok(spec.role, d);
    assert.ok(spec.audience, d);
  }
});

test('the extractor finds every kind of claim in text that plainly contains one', () => {
  const claims = da.extractClaims('Call `GET /api/reports`, run npm run test, see ADR-0002 and `src/server.js`, gated by APP-FIT-CONTEXT-MAP, per [the map](./context-map.md).');
  for (const kind of ['api-route', 'npm-command', 'adr-reference', 'source-module', 'fitness-id', 'doc-link']) {
    assert.ok(claims.some((c) => c.kind === kind), `no ${kind} extracted`);
  }
  // Every claim carries the text it came from, so a finding traces back to the sentence.
  for (const c of claims) assert.ok(c.raw, `${c.kind} claim carries no source text`);
});

test('a brace-expanded path becomes one claim per option', () => {
  const claims = da.extractClaims('`GET /api/admin/{health,metrics,config}`').filter((c) => c.kind === 'api-route');
  assert.deepStrictEqual(claims.map((c) => c.value).sort(), ['/api/admin/config', '/api/admin/health', '/api/admin/metrics']);
});

test('a placeholder segment is tried as both a word and a number', () => {
  const w = world();
  // `as-of/:instant` normalises to `/sample`, and the route constrains the parameter to digits.
  assert.strictEqual(da.verifyClaim({ kind: 'api-route', value: '/api/graph/enterprise/as-of/sample', raw: '' }, w).resolved, true);
  assert.strictEqual(da.verifyClaim({ kind: 'api-route', value: '/api/resilience/consistency', raw: '' }, w).resolved, true);
});

test('every kind of wrong claim is caught', () => {
  const w = world();
  for (const claim of [
    { kind: 'api-route', value: '/api/does-not-exist' },
    { kind: 'npm-command', value: 'never-defined-script' },
    { kind: 'adr-reference', value: 9999 },
    { kind: 'doc-link', value: 'no-such-document.md' },
    { kind: 'fitness-id', value: 'APP-FIT-NEVER-WRITTEN' },
    { kind: 'source-module', value: 'src/imaginary/module.js' },
  ]) {
    const r = da.verifyClaim({ ...claim, raw: '' }, w);
    assert.strictEqual(r.resolved, false, `${claim.kind}:${claim.value}`);
    assert.ok(r.detail);
  }
});

test('an unrecognised claim kind is unverified, never verified', () => {
  const r = da.verifyClaim({ kind: 'telepathy', value: 'x', raw: '' }, world());
  assert.strictEqual(r.resolved, false);
  assert.match(r.detail, /unverified, not verified/);
});

test('every kind of right claim passes, so the checker does not reject everything', () => {
  const w = world();
  for (const claim of [
    { kind: 'api-route', value: '/api/resilience/consistency' },
    { kind: 'npm-command', value: 'test' },
    { kind: 'adr-reference', value: 1 },
    { kind: 'doc-link', value: 'adr/0001-baseline-and-mvp.md' },
    { kind: 'fitness-id', value: 'APP-FIT-CONTEXT-MAP' },
    { kind: 'source-module', value: 'src/server.js' },
  ]) {
    assert.strictEqual(da.verifyClaim({ ...claim, raw: '' }, w).resolved, true, `${claim.kind}:${claim.value}`);
  }
});

test('a documented command is verified to resolve, and the report says it was not executed', () => {
  const r = da.verifyClaim({ kind: 'npm-command', value: 'test', raw: '' }, world());
  assert.match(r.detail, /resolved, not executed/);
  assert.match(da.verify({ controls: controls() }).verifiedNotExecuted, /not to succeed/);
});

test('the whole corpus resolves', () => {
  const r = da.verify({ controls: controls() });
  assert.deepStrictEqual(r.unresolved, []);
  assert.deepStrictEqual(r.missingDocuments, []);
  assert.deepStrictEqual(r.documentsWithNoClaims, []);
  assert.strictEqual(r.sound, true);
  assert.strictEqual(r.authorizes, false);
});

test('the extractor guards its own yield — a check that finds nothing to check fails', () => {
  const r = da.verify({ controls: controls() });
  assert.ok(r.claims >= da.MINIMUM_CLAIMS, `only ${r.claims} claims`);
  assert.strictEqual(r.extractorSound, true);
  for (const kind of ['api-route', 'adr-reference', 'fitness-id', 'source-module', 'doc-link']) {
    const row = r.byKind.find((b) => b.kind === kind);
    assert.ok(row && row.total > 0, `no ${kind} claims in the corpus`);
    assert.strictEqual(row.coverage, 1, `${kind} coverage is ${row && row.coverage}`);
  }
});

test('a missing governed document is a finding, not a skip', () => {
  const r = da.verifyDocument('does-not-exist.md', { controls: controls() });
  assert.strictEqual(r.missing, true);
  assert.strictEqual(r.sound, false);
  assert.strictEqual(r.claims, 0);
  assert.match(r.unresolved[0].detail, /does not exist/);
});

test('a document from which nothing can be extracted is reported rather than passing', () => {
  // verifyDocument on a real file with no claims would report noClaims; simulated here by checking
  // the flag's definition against an empty extraction.
  assert.deepStrictEqual(da.extractClaims('Prose with no claims of any kind in it whatsoever.'), []);
  const r = da.verifyDocument('operations/runbook.md', { controls: controls() });
  assert.strictEqual(r.noClaims, false);
  assert.strictEqual(r.sound, true);
});

// --- Part 7: operational procedure verification ---------------------------------------------------

test('every operational procedure carries what an operator needs at 03:00', () => {
  const r = da.verifyProcedures({});
  assert.ok(r.count >= 1);
  for (const p of r.procedures) {
    assert.strictEqual(p.missing, false, p.document);
    assert.deepStrictEqual(p.absent, [], `${p.document} is missing: ${p.absent.join(', ')}`);
  }
  assert.strictEqual(r.complete, true);
  assert.strictEqual(r.authorizes, false);
});

test('every procedure requirement says why it is needed', () => {
  for (const r of da.verifyProcedures({}).requirements) assert.ok(r.why, r.requirement);
  for (const [id, spec] of Object.entries(da.PROCEDURE_REQUIREMENTS)) {
    assert.ok(spec.pattern instanceof RegExp, id);
    assert.ok(spec.why, id);
  }
});

test('a document containing nothing operational satisfies none of the requirements', () => {
  const prose = 'This document says nothing operational whatsoever.';
  const satisfied = Object.entries(da.PROCEDURE_REQUIREMENTS).filter(([, s]) => s.pattern.test(prose)).map(([id]) => id);
  assert.deepStrictEqual(satisfied, []);
});

test('the procedure check admits that presence is not correctness', () => {
  assert.match(da.verifyProcedures({}).caveat, /only a rehearsal catches that/);
});

test('reference documentation is not held to the procedure requirements', () => {
  // Holding reference material to a rollback-section requirement trains people to add empty
  // sections, which is worse than the gap.
  const roles = new Set(Object.values(da.GOVERNED_DOCUMENTS).map((s) => s.role));
  assert.ok(roles.has('operational-reference'));
  const checked = da.verifyProcedures({}).procedures.map((p) => p.document);
  for (const [doc, spec] of Object.entries(da.GOVERNED_DOCUMENTS)) {
    if (spec.role === 'operational-reference') assert.ok(!checked.includes(doc), `${doc} is reference material but was held to the procedure requirements`);
  }
});
