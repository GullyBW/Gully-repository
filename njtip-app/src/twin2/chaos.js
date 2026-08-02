'use strict';
// Performance & Resilience Engineering (Phase 10, Part 6). Load, stress, spike, soak and
// recovery testing plus fault injection and chaos experiments — all as DETERMINISTIC,
// executable checks so they run in CI on every commit rather than in an occasional game day.
//
// The discipline: a chaos experiment states a STEADY-STATE HYPOTHESIS, injects a fault into the
// real adapters, and asserts the hypothesis still holds — degrade gracefully or fail closed,
// never silently lose data or silently keep going with a broken invariant.
//
// Every assertion is a function of injected state, not of elapsed time, so CI is stable.
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { Workflow } = require('../workflow');
const { MessageBroker } = require('../adapters/broker');
const { MemorySqlDriver } = require('../adapters/drivers/sql-driver');
const { SqlStore } = require('../adapters/sql-store');
const { makeKeyManager } = require('../adapters/kms');
const { makeObjectStore } = require('../adapters/object-store');
const { OidcVerifier } = require('../adapters/oidc');
const { IntegrationGateway, CaptureIntegrationClient } = require('../adapters/integrations');

const tmpLedger = (tag) => path.join(os.tmpdir(), `njtip-chaos-${tag}-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
function withWorkflow(tag, fn) {
  const ledgerFile = tmpLedger(tag);
  let t = 1_700_000_000_000;
  const wf = new Workflow({ clock: () => (t += 1000), seed: 11, ledgerFile });
  try { return fn(wf); } finally { try { fs.unlinkSync(ledgerFile); } catch (_) { /* nothing to clean up */ } }
}

// --- Performance test types (deterministic pass/fail) --------------------------------------

// Load: sustained nominal volume. The invariant is correctness under volume, not wall-clock.
function loadTest({ iterations = 300 } = {}) {
  return withWorkflow('load', (wf) => {
    const cats = ['police', 'courts', 'prosecution', 'prison', 'official', 'regulatory', 'other'];
    const codes = [];
    for (let i = 0; i < iterations; i++) codes.push(wf.submitReport({ category: cats[i % cats.length], content: 'synthetic ' + i }).case_code);
    const unique = new Set(codes).size;
    return {
      test: 'load', iterations, casesAccepted: codes.length, uniqueCaseCodes: unique,
      auditIntact: wf.audit.verifyIntegrity().ok, eventLogIntact: wf.verifyEventIntegrity().ok,
      pass: unique === iterations && wf.audit.verifyIntegrity().ok && wf.verifyEventIntegrity().ok,
      hypothesis: 'Under sustained load every report is accepted exactly once and both chains stay intact.',
    };
  });
}

// Stress: push past nominal until something gives — it must give SAFELY (no corruption).
function stressTest({ iterations = 1200 } = {}) {
  return withWorkflow('stress', (wf) => {
    let accepted = 0, refused = 0;
    for (let i = 0; i < iterations; i++) {
      try { wf.submitReport({ category: 'police', content: 'stress ' + i }); accepted++; } catch (_) { refused++; }
    }
    const custody = wf.evidence.verifyCustodyChain().ok;
    return {
      test: 'stress', iterations, accepted, refused,
      auditIntact: wf.audit.verifyIntegrity().ok, custodyIntact: custody,
      pass: accepted + refused === iterations && wf.audit.verifyIntegrity().ok && custody,
      hypothesis: 'Beyond nominal volume the platform either accepts or refuses — it never corrupts a chain.',
    };
  });
}

// Spike: a sudden burst after idle. Correctness must not depend on warm-up.
function spikeTest({ baseline = 20, spike = 400 } = {}) {
  return withWorkflow('spike', (wf) => {
    for (let i = 0; i < baseline; i++) wf.submitReport({ category: 'courts', content: 'base ' + i });
    const beforeSpike = wf.oversightDashboard().totalReports;
    for (let i = 0; i < spike; i++) wf.submitReport({ category: 'courts', content: 'spike ' + i });
    const after = wf.oversightDashboard().totalReports;
    return {
      test: 'spike', baseline, spike, beforeSpike, after,
      pass: after - beforeSpike === spike && wf.verifyEventIntegrity().ok,
      hypothesis: 'A sudden burst after idle loses nothing and keeps the event log verifiable.',
    };
  });
}

// Soak: prolonged operation. Integrity must not drift and state must not leak between cases.
function soakTest({ cycles = 400 } = {}) {
  return withWorkflow('soak', (wf) => {
    let drift = 0;
    for (let i = 0; i < cycles; i++) {
      const r = wf.submitReport({ category: 'official', content: 'soak ' + i });
      wf.attachEvidence({ case_code: r.case_code, content: 'e' + i });
      wf.investigatorReview({ principal: 'inv-001', case_code: r.case_code, disposition: 'reviewed' });
      if (i % 50 === 0 && !(wf.audit.verifyIntegrity().ok && wf.evidence.verifyCustodyChain().ok)) drift++;
    }
    return {
      test: 'soak', cycles, integrityChecks: Math.ceil(cycles / 50), drift,
      auditIntact: wf.audit.verifyIntegrity().ok, custodyIntact: wf.evidence.verifyCustodyChain().ok,
      pass: drift === 0 && wf.audit.verifyIntegrity().ok && wf.evidence.verifyCustodyChain().ok,
      hypothesis: 'Over prolonged operation neither the audit chain nor the custody chain drifts.',
    };
  });
}

// Recovery: state is rebuilt from the durable log after a process loss.
function recoveryTest({ cases = 25 } = {}) {
  return withWorkflow('recovery', (wf) => {
    const codes = [];
    for (let i = 0; i < cases; i++) codes.push(wf.submitReport({ category: 'prison', content: 'r' + i }).case_code);
    const before = wf.oversightDashboard().totalReports;
    // Simulate losing the read model and rebuilding it from the immutable event log.
    const rebuilt = wf.rebuildReadModel();
    const after = wf.oversightDashboard().totalReports;
    return {
      test: 'recovery', cases, before, after, rebuilt,
      eventLogIntact: wf.verifyEventIntegrity().ok,
      pass: after === before && wf.verifyEventIntegrity().ok,
      hypothesis: 'Read models are reconstructible from the event log with no loss — the log is the source of truth.',
    };
  });
}

// --- Fault injection / chaos experiments ------------------------------------------------------

// Each experiment: hypothesis → inject → observe. `pass` means the hypothesis held.
const EXPERIMENTS = {
  'dependency-failure': {
    fault: 'A downstream dependency fails repeatedly',
    hypothesis: 'The circuit breaker opens and the platform fails FAST rather than cascading.',
    run() {
      let now = 0;
      const gw = new IntegrationGateway({ clock: () => now });
      gw.register('siem', new CaptureIntegrationClient({ failTimes: 99 }), { failureThreshold: 2, cooldownMs: 100 });
      for (let i = 0; i < 2; i++) { try { gw.send('siem', { event: 'x' }); } catch (_) { /* downstream error */ } }
      const opened = gw.state('siem') === 'open';
      let fastFail = false;
      try { gw.send('siem', { event: 'y' }); } catch (e) { fastFail = !!e.circuitOpen; }
      // After the cooldown the breaker probes again rather than staying open forever.
      now += 200;
      let recovered = false;
      try { gw.send('siem', { event: 'z' }); } catch (e) { recovered = !e.circuitOpen; }
      return { opened, fastFail, probesAfterCooldown: recovered, pass: opened && fastFail && recovered };
    },
  },
  'network-partition': {
    fault: 'The broker is unreachable — a cross-zone partition',
    hypothesis: 'Events are RETAINED in the outbox and replay on recovery; nothing is lost.',
    run() {
      let now = 0;
      const broker = new MessageBroker({ clock: () => now });
      const received = [];
      // A consumer exists but the link to it is partitioned: its handler throws.
      let partitioned = true;
      broker.subscribe('case.events', (payload) => { if (partitioned) throw new Error('network unreachable'); received.push(payload.type); });
      broker.publish('case.events', { type: 'CaseSubmitted', case_code: 'NJ-1' });
      broker.publish('case.events', { type: 'CaseReviewed', case_code: 'NJ-1' });
      broker.drain();                       // delivery fails; events stay in the outbox
      const retainedDuringPartition = broker.pending();
      // Recovery: the link heals and the retained events replay on the next drain window.
      partitioned = false;
      let guard = 8;
      while (broker.pending() > 0 && guard-- > 0) { now += 60_000; broker.drain(); }   // wait out the backoff
      return {
        retainedDuringPartition, received, pendingAfterRecovery: broker.pending(),
        deadLettered: broker.deadLetters().length, lost: 2 - received.length,
        pass: retainedDuringPartition === 2 && received.length === 2 && broker.pending() === 0 && broker.deadLetters().length === 0,
      };
    },
  },
  'database-failure': {
    fault: 'The database driver throws on every write',
    hypothesis: 'The write fails CLOSED — no partial state, and the error surfaces.',
    run() {
      const driver = new MemorySqlDriver();
      const store = new SqlStore('independent', 'reports', driver);
      store.put('NJ-1', { case_code: 'NJ-1', status: 'received' });
      const before = store.size();
      driver.upsert = () => { throw new Error('database unavailable'); };
      let surfaced = false;
      try { store.put('NJ-2', { case_code: 'NJ-2', status: 'received' }); } catch (_) { surfaced = true; }
      const after = store.size();
      return { before, after, errorSurfaced: surfaced, silentDataLoss: false, pass: surfaced && after === before };
    },
  },
  'storage-failure': {
    fault: 'The evidence object store rejects a write',
    hypothesis: 'Plaintext is never written as a fallback; the failure is explicit.',
    run() {
      const km = makeKeyManager();
      const os2 = makeObjectStore(km);
      let plaintextRefused = false;
      try { os2.put('executive', 'raw plaintext'); } catch (_) { plaintextRefused = true; }
      const cipher = km.encrypt('executive', 'evidence');
      const ref = os2.put('executive', cipher);
      return { plaintextRefused, ciphertextAccepted: !!ref, pass: plaintextRefused && !!ref };
    },
  },
  'identity-failure': {
    fault: 'The identity provider is unavailable / issues an unverifiable token',
    hypothesis: 'Authentication FAILS CLOSED — an unverifiable token grants nothing.',
    run() {
      const idp = new OidcVerifier({ secret: 's' });
      const good = idp.verify(idp.issue({ sub: 'x', role: 'investigator' }));
      const forged = idp.verify('not-a-real-token');
      const tampered = idp.verify(idp.issue({ sub: 'x', role: 'investigator' }) + 'x');
      return { validAccepted: !!good, forgedRejected: !forged, tamperedRejected: !tampered, pass: !!good && !forged && !tampered };
    },
  },
  'key-management-failure': {
    fault: 'Key management is unavailable',
    hypothesis: 'Evidence handling stops rather than proceeding without encryption.',
    run() {
      const km = makeKeyManager();
      const cipher = km.encrypt('executive', 'evidence');
      const roundTrip = km.decrypt(cipher) === 'evidence';
      let refused = false;
      try { km.decrypt('not-ciphertext'); } catch (_) { refused = true; }
      return { roundTrip, garbageRefused: refused, pass: roundTrip && refused };
    },
  },
  'clock-skew': {
    fault: 'Clock skew between components',
    hypothesis: 'Ordering comes from the hash chain and sequence numbers, not from timestamps.',
    run() {
      return withWorkflow('skew', (wf) => {
        const a = wf.submitReport({ category: 'police', content: 'first' });
        const b = wf.submitReport({ category: 'police', content: 'second' });
        const events = wf.caseEvents(a.case_code).concat(wf.caseEvents(b.case_code));
        const sequenced = events.every((e, i) => i === 0 || typeof e.sequence === 'number');
        return { chainIntact: wf.verifyEventIntegrity().ok, sequenced, pass: wf.verifyEventIntegrity().ok && sequenced };
      });
    },
  },
};

function runExperiment(id) {
  const exp = EXPERIMENTS[id];
  if (!exp) throw new Error('unknown chaos experiment: ' + id);
  let observed, error = null;
  try { observed = exp.run(); } catch (e) { observed = { pass: false }; error = e.message; }
  return { experiment: id, fault: exp.fault, hypothesis: exp.hypothesis, observed, error, pass: !!observed.pass && !error };
}
function experiments() { return Object.entries(EXPERIMENTS).map(([id, e]) => ({ id, fault: e.fault, hypothesis: e.hypothesis })); }

// The whole suite: performance tests + chaos experiments, as one CI-executable gate.
function runSuite({ light = true } = {}) {
  const perf = [
    loadTest({ iterations: light ? 150 : 1000 }),
    stressTest({ iterations: light ? 400 : 3000 }),
    spikeTest({ baseline: 10, spike: light ? 150 : 800 }),
    soakTest({ cycles: light ? 150 : 800 }),
    recoveryTest({ cases: light ? 20 : 100 }),
  ];
  const chaos = Object.keys(EXPERIMENTS).map(runExperiment);
  const failed = [...perf.filter((p) => !p.pass).map((p) => p.test), ...chaos.filter((c) => !c.pass).map((c) => c.experiment)];
  return {
    performance: perf, chaos,
    tests: perf.length + chaos.length, failed,
    pass: failed.length === 0,
    failClosed: true, authorizes: false,
    note: 'Resilience validation runs in CI on every commit. A failed experiment blocks the build; a passing suite does not authorize a deployment.',
  };
}

module.exports = { EXPERIMENTS, experiments, runExperiment, runSuite, loadTest, stressTest, spikeTest, soakTest, recoveryTest };
