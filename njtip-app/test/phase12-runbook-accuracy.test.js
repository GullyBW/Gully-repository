'use strict';
// Phase 12 close-out — the operational runbook is checked against the running server, not trusted.
//
// A runbook that tells an operator to call a route which no longer exists is worse than no runbook:
// it is consulted at 03:00, by someone under pressure, who will believe it. These tests drive the
// documented routes over real HTTP rather than pattern-matching `server.js`, so a route that exists
// in source but is unreachable in the composed app still fails.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../src/server');
const { Workflow } = require('../src/workflow');

const RUNBOOK = path.join(__dirname, '..', 'docs', 'operations', 'runbook.md');
const ADMIN = 'admin-token-synthetic';
const OVERSIGHT = 'gov-token-synthetic';

let server, base, ledgerFile;

before(async () => {
  ledgerFile = path.join(os.tmpdir(), `njtip-runbook-${process.pid}.json`);
  server = createServer({ workflow: new Workflow({ seed: 7, ledgerFile }) });
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); try { fs.unlinkSync(ledgerFile); } catch (_) {} });

function req(method, p, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = { 'content-type': 'application/json' };
    if (token) headers.authorization = 'Bearer ' + token;
    const r = http.request(base + p, { method, headers }, (res) => {
      let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

test('the runbook records the partition guidance ADR-0007 commits to', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8');
  // ADR-0007 states, under Operational impact, that the partition runbook gains this line. An ADR
  // whose stated consequence was never carried out is exactly the drift this platform refuses.
  assert.match(text, /sessionDependent/);
  assert.match(text, /settled at read time/);
  assert.match(text, /0007-session-consistency-and-adr-review-lifecycle/);
  // And the operator is told what an `unavailable` context means, since refusing is the design.
  assert.match(text, /refusing rather than degrading/);
});

test('the runbook covers the Phase 12 operator surfaces', () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8');
  for (const surface of [
    '/api/twin/operations/simulate',
    '/api/supply-chain/deployability',
    '/api/contracts/release-impact',
    '/api/observability/mission-forecast',
    '/api/governance/continuity/dashboard',
  ]) assert.ok(text.includes(surface), `the runbook does not mention ${surface}`);
});

test('every route the runbook names is reachable on the running server', async () => {
  const text = fs.readFileSync(RUNBOOK, 'utf8');
  const paths = new Set();
  for (const m of text.matchAll(/(\/api\/[A-Za-z0-9/{},:<>_-]*)/g)) {
    const raw = m[1].replace(/[.,)]+$/, '');
    const brace = raw.match(/^(.*)\{([^}]*)\}(.*)$/);
    const variants = brace ? brace[2].split(',').map((o) => `${brace[1]}${o.trim()}${brace[3]}`) : [raw];
    for (const variant of variants) {
      const normalised = variant.replace(/\/$/, '').split('/')
        .map((seg) => (seg.startsWith('<') || seg.startsWith(':') ? 'bw-south' : seg)).join('/');
      if (normalised.length > 4) paths.add(normalised);
    }
  }
  assert.ok(paths.size >= 8, `only ${paths.size} paths extracted from the runbook`);
  for (const p of paths) {
    // GET first; a route that only accepts POST answers 405/400 rather than 404. What must never
    // come back is 404 — that is the runbook naming something the server does not serve.
    const got = await req('GET', p, null, ADMIN);
    if (got.status === 404) {
      const posted = await req('POST', p, {}, ADMIN);
      assert.notStrictEqual(posted.status, 404, `the runbook names '${p}', which the server does not serve`);
    }
  }
});

test('a fabricated route really does 404 — so the check above can fail', async () => {
  const missing = await req('GET', '/api/resilience/consistency-posture', null, ADMIN);
  assert.strictEqual(missing.status, 404);
  const alsoMissing = await req('POST', '/api/does-not-exist/anything', {}, ADMIN);
  assert.strictEqual(alsoMissing.status, 404);
});

test('the documented pre-deployment gates answer, and none of them authorizes', async () => {
  const deployability = await req('POST', '/api/supply-chain/deployability', { artifact: 'njtip-app', artifactDigest: 'unbuilt' }, ADMIN);
  assert.strictEqual(deployability.status, 200);
  assert.strictEqual(deployability.body.deployable, false);      // no builder, no scans
  assert.strictEqual(deployability.body.authorizes, false);

  const release = await req('POST', '/api/contracts/release-impact', { release: 'nothing-submitted', changes: [] }, ADMIN);
  assert.strictEqual(release.status, 200);
  assert.strictEqual(release.body.deployable, false);            // an unassessed release is not safe
  assert.strictEqual(release.body.authorizes, false);

  const mission = await req('POST', '/api/observability/mission-forecast', { change: 'docs only', failed: [] }, OVERSIGHT);
  assert.strictEqual(mission.status, 200);
  assert.strictEqual(mission.body.safeToDeploy, true);
  assert.strictEqual(mission.body.authorizes, false);
});

test('the documented twin simulation runs and leaves the baseline untouched', async () => {
  const before = await req('GET', '/api/twin/operations', null, ADMIN);
  assert.strictEqual(before.status, 200);
  const digest = before.body.model.digest;

  const sim = await req('POST', '/api/twin/operations/simulate', { scenario: 'dr-exercise', change: { failedRegions: ['bw-south', 'bw-north'] } }, ADMIN);
  assert.strictEqual(sim.status, 200);
  assert.strictEqual(sim.body.isolation.unchanged, true);
  assert.strictEqual(sim.body.safe, false);                       // losing quorum makes contexts refuse
  assert.strictEqual(sim.body.authorizes, false);

  const after = await req('GET', '/api/twin/operations', null, ADMIN);
  assert.strictEqual(after.body.model.digest, digest, 'a simulation changed the production model');
});

test('the documented partition view marks session-scoped rows as settled at read time', async () => {
  const posture = await req('GET', '/api/resilience/consistency', null, ADMIN);
  assert.strictEqual(posture.status, 200);
  const investigation = posture.body.contexts.find((c) => c.context === 'investigation');
  assert.strictEqual(investigation.model, 'read-your-writes');
  assert.ok(investigation.adr, 'the consistency stance cites no ADR');
  const failover = await req('GET', '/api/resilience/consistency/failover/bw-south,bw-north', null, ADMIN);
  assert.strictEqual(failover.status, 200);
  assert.strictEqual(failover.body.noGuaranteeWeakened, true);
  assert.ok(failover.body.unavailable.length > 0);
});
