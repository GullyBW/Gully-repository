'use strict';

// Phase 18.1 close-out — application integration for Part 7 and Batch 7.
//
// Unit tests prove the register computes the right thing. These prove the whole path does:
//
//     request → auth → composition → RequirementRegister → epistemic evaluation → response
//
// The property that matters most here is the one easiest to lose at a serialisation boundary. Four
// states leave the register — COMPLIANT, NON_COMPLIANT, EVIDENCE_UNRESOLVED, UNKNOWN,
// HUMAN_REVIEW_REQUIRED — and any layer that maps them onto "ok / not ok" for the convenience of a
// caller has destroyed the distinction the whole phase exists to preserve. In particular:
//
//     UNKNOWN != HUMAN_REVIEW_REQUIRED
//
// Nobody has looked, versus a machine looked as far as a machine can and a person must finish.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { createServer } = require('../src/server');
const { Workflow } = require('../src/workflow');

let server, base, ledgerFile, adminToken;

before(async () => {
  ledgerFile = path.join(os.tmpdir(), `njtip-p181-${process.pid}.json`);
  server = createServer({ workflow: new Workflow({ seed: 7, ledgerFile }) });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  adminToken = (await req('POST', '/api/auth/session', { credential: 'demo-admin' })).body.token;
});
after(() => { server.close(); try { fs.unlinkSync(ledgerFile); } catch (_) {} });

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const r = http.request(base + p, { method, headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c));
      res.on('end', () => { try { resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }); } catch (_) { resolve({ status: res.statusCode, body: d }); } });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

const COMPLIANCE = '/api/architecture/specification-compliance';

test('phase18.1 api: specification compliance requires authorization', async () => {
  const anon = await req('GET', COMPLIANCE);
  assert.equal(anon.status, 401);
  // An investigator is authenticated and still not entitled to this.
  const inv = (await req('POST', '/api/auth/session', { credential: 'demo-investigator' })).body.token;
  assert.equal((await req('GET', COMPLIANCE, null, inv)).status, 401);
  assert.equal((await req('GET', COMPLIANCE, null, 'not-a-real-token')).status, 401);
});

test('phase18.1 api: a valid request returns the dashboard over the synthetic corpus', async () => {
  const r = await req('GET', COMPLIANCE, null, adminToken);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.requirements));
  assert.ok(r.body.requirements.length >= 7, 'the register reached the API empty');
  // SYNTHETIC ONLY, and the response says so rather than leaving a reader to assume it.
  for (const row of r.body.requirements) assert.match(row.requirement, /^SYN-/);
  assert.equal(r.body.authorizes, false);
  assert.equal(r.body.producesInstitutionalVerdict, false);
});

test('phase18.1 api: a malformed parameter is refused rather than guessed at', async () => {
  const bad = await req('GET', `${COMPLIANCE}?evidence=maybe`, null, adminToken);
  assert.equal(bad.status, 400);
  assert.match(String(bad.body.error || ''), /evidence must be/);
  // …and the two valid values are both accepted.
  assert.equal((await req('GET', `${COMPLIANCE}?evidence=true`, null, adminToken)).status, 200);
  assert.equal((await req('GET', `${COMPLIANCE}?evidence=false`, null, adminToken)).status, 200);
});

test('phase18.1 api: every compliance state survives the serialisation boundary', async () => {
  const withEvidence = (await req('GET', `${COMPLIANCE}?evidence=true`, null, adminToken)).body;
  const without = (await req('GET', `${COMPLIANCE}?evidence=false`, null, adminToken)).body;
  const states = (d) => new Set(d.requirements.map((r) => r.state));

  // With verification input: four states, including the one that means a person must look.
  assert.ok(states(withEvidence).has('COMPLIANT'));
  assert.ok(states(withEvidence).has('NON_COMPLIANT'));
  assert.ok(states(withEvidence).has('EVIDENCE_UNRESOLVED'));
  assert.ok(states(withEvidence).has('HUMAN_REVIEW_REQUIRED'));

  // Without it: UNKNOWN appears, because nothing was supplied to check against. That is the honest
  // answer to a question asked without evidence, and it is not an error.
  assert.ok(states(without).has('UNKNOWN'));

  // THE DISTINCTION. Both are epistemically unknown and they are different institutional facts, and
  // the API must not have flattened them into one.
  const unknown = without.requirements.filter((r) => r.state === 'UNKNOWN');
  const human = without.requirements.filter((r) => r.state === 'HUMAN_REVIEW_REQUIRED');
  assert.ok(unknown.length > 0 && human.length > 0);
  assert.notDeepEqual(unknown.map((r) => r.requirement), human.map((r) => r.requirement));
  for (const r of unknown) assert.match(r.detail, /nothing was supplied|nothing has been checked/);
  for (const r of human) assert.match(r.detail, /substantively adequate/);
});

test('phase18.1 api: a specification nobody declared requirements for is unknown, not absent', async () => {
  const r = await req('GET', `${COMPLIANCE}?specifications=SYNTHETIC-CORPUS,SPEC-NOBODY-WROTE`, null, adminToken);
  assert.equal(r.status, 200);
  const ghost = r.body.bySpecification.find((s) => s.specification === 'SPEC-NOBODY-WROTE');
  assert.ok(ghost, 'an expected specification with no requirements vanished from the response');
  assert.equal(ghost.state, 'UNKNOWN');
  assert.equal(ghost.measurable, false);
  assert.notEqual(r.body.overall, 'COMPLIANT');
});

test('phase18.1 api: the machine/human boundary reaches the caller', async () => {
  const r = (await req('GET', COMPLIANCE, null, adminToken)).body;
  assert.match(r.machineDetectable, /no declared requirements at all/);
  assert.match(r.humanJudgementRequired, /substantively adequate/);
  // No percentage anywhere in the response body.
  assert.doesNotMatch(JSON.stringify(r.basis), /\d+\s?%/);
  assert.ok(!('complianceRate' in r));
});

test('phase18.1 api: the requirements matrix reaches the caller and names missing evidence', async () => {
  const r = await req('GET', '/api/architecture/requirements-matrix', null, adminToken);
  assert.equal(r.status, 200);
  assert.ok(r.body.count >= 7);
  // The corpus deliberately contains a requirement whose declarations point at nothing.
  assert.ok(r.body.brokenMappings.length > 0, 'a stale declaration did not surface in the matrix');
  assert.ok(r.body.brokenMappings.some((b) => b.requirement === 'SYN-STALE-EVIDENCE'));
  assert.equal(r.body.authorizes, false);
});

test('phase18.1 api: a requirement that does not exist is reported missing rather than invented', async () => {
  const r = (await req('GET', '/api/architecture/requirements-matrix', null, adminToken)).body;
  assert.equal(r.requirements.find((x) => x.requirement === 'SYN-DOES-NOT-EXIST'), undefined);
  // …and the register refuses to verify one, rather than returning an empty pass.
  const adr = require('../src/architecture/adr-governance');
  const reg = new adr.RequirementRegister({ clock: () => 0 });
  assert.throws(() => reg.verify('NOPE', { controls: [] }), /unknown requirement/);
});

test('phase18.1 api: governance resilience is read by the board it escalates to', async () => {
  const anon = await req('GET', '/api/governance/governance-resilience');
  assert.equal(anon.status, 401);
  // Admin is not the Oversight Board. A finding that goes to a board is read by that board.
  assert.equal((await req('GET', '/api/governance/governance-resilience', null, adminToken)).status, 401);

  const ob = (await req('POST', '/api/auth/session', { credential: 'demo-oversight' })).body.token;
  const r = await req('GET', '/api/governance/governance-resilience', null, ob);
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 5);
  assert.equal(r.body.blocksInstitutionalReadiness, false, 'a governance finding must not block a build');
  assert.equal(r.body.governanceReviewRequired.length, 5);
  assert.equal(r.body.authorizes, false);
  assert.ok(r.body.singlePointDependencies.length >= 5);
  assert.doesNotMatch(String(r.body.basis), /\d+\s?%/);
});

test('phase18.1 api: an empty register reports nothing known rather than nothing wrong', async () => {
  // Exercised directly against a fresh register, since the composed one is seeded by design.
  const adr = require('../src/architecture/adr-governance');
  const empty = new adr.RequirementRegister({ clock: () => 0 })
    .specificationCompliance({ specifications: ['SYNTHETIC-CORPUS'], now: 0 });
  assert.equal(empty.overall, 'UNKNOWN');
  assert.equal(empty.measurable, false);
  assert.match(empty.bySpecification[0].reason, /An empty register is not a clean one/);
});

test('phase18.1 api: responses are deterministic for a fixed register', async () => {
  const a = (await req('GET', `${COMPLIANCE}?evidence=true`, null, adminToken)).body;
  const b = (await req('GET', `${COMPLIANCE}?evidence=true`, null, adminToken)).body;
  const strip = (d) => JSON.stringify({ ...d, now: 0, requirements: d.requirements.map((r) => ({ ...r, humanReview: null })) });
  assert.equal(strip(a), strip(b));
});
