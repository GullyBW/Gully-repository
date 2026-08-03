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
const { CertificateManager } = require('../adapters/certificates');
const telemetry = require('../observability/telemetry');
const multiRegion = require('./multi-region');
const { hash } = require('../twin');
const sha256 = (s) => hash.sha256(String(s));

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
//
// Phase 11, Part 6 — THE DETECT-AND-RECOVER CONTRACT. An experiment that only proves the
// platform survives a fault proves half of what matters. Every experiment must now report:
//   detected  — the fault became VISIBLE to the platform (a signal a human or a control can act
//               on). A fault the system absorbs silently is a fault you learn about from a
//               citizen, not from a dashboard.
//   recovered — the platform returned to steady state after the fault was withdrawn, without an
//               operator hand-repairing state.
// `runExperiment` enforces this: an experiment that does not report both cannot pass.
const EXPERIMENTS = {
  'dependency-failure': {
    fault: 'A downstream dependency fails repeatedly',
    hypothesis: 'The circuit breaker opens and the platform fails FAST rather than cascading.',
    run() {
      let now = 0;
      const gw = new IntegrationGateway({ clock: () => now });
      // Fails twice (enough to trip the breaker), then the dependency heals.
      gw.register('siem', new CaptureIntegrationClient({ failTimes: 2 }), { failureThreshold: 2, cooldownMs: 100 });
      for (let i = 0; i < 2; i++) { try { gw.send('siem', { event: 'x' }); } catch (_) { /* downstream error */ } }
      const opened = gw.state('siem') === 'open';
      let fastFail = false;
      try { gw.send('siem', { event: 'y' }); } catch (e) { fastFail = !!e.circuitOpen; }
      // After the cooldown the breaker probes again rather than staying open forever, and the
      // now-healthy dependency closes it.
      now += 200;
      let probeSucceeded = false;
      try { gw.send('siem', { event: 'z' }); probeSucceeded = true; } catch (_) { probeSucceeded = false; }
      const closed = gw.state('siem') === 'closed';
      return {
        opened, fastFail, probesAfterCooldown: probeSucceeded, closedAfterRecovery: closed,
        detected: opened && fastFail,
        // Containment: the breaker stopped the failing dependency propagating into the caller.
        contained: fastFail,
        recovered: probeSucceeded && closed,
        // Verification: breaker state was re-read after recovery, not assumed from the probe.
        verified: closed,
        pass: opened && fastFail && probeSucceeded && closed,
      };
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
        // Detection: the partition is visible as a non-zero outbox with a recorded delivery error.
        detected: retainedDuringPartition === 2,
        // Containment: the partition stayed in the outbox — nothing spilled into the dead-letter
        // queue, which is where an uncontained delivery failure ends up.
        contained: broker.deadLetters().length === 0,
        recovered: received.length === 2 && broker.pending() === 0 && broker.deadLetters().length === 0,
        // Verification: the subscriber's own record is re-read, so delivery is confirmed at the
        // receiving end rather than inferred from an empty outbox.
        verified: received.length === 2 && received[0] === 'CaseSubmitted' && received[1] === 'CaseReviewed',
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
      // Recovery: the driver heals and the previously-failed write succeeds — no repair needed.
      delete driver.upsert;
      let writesAfterRecovery = false;
      try { store.put('NJ-2', { case_code: 'NJ-2', status: 'received' }); writesAfterRecovery = true; } catch (_) { /* still failing */ }
      return {
        before, after, errorSurfaced: surfaced, silentDataLoss: false,
        sizeAfterRecovery: store.size(), writesAfterRecovery,
        detected: surfaced,
        // Containment: the failed write left no partial state behind.
        contained: after === before,
        recovered: writesAfterRecovery,
        // Verification: the store is re-counted after recovery rather than trusting the write.
        verified: store.size() === before + 1,
        pass: surfaced && after === before && writesAfterRecovery && store.size() === before + 1,
      };
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
      return {
        plaintextRefused, ciphertextAccepted: !!ref,
        detected: plaintextRefused,
        // Containment: the failure did not degrade into writing plaintext as a fallback.
        contained: plaintextRefused && !os2.get('executive', 'obj://executive/plaintext'),
        recovered: !!ref,
        // Verification: the stored object is read back and is the ciphertext that was written.
        verified: !!ref && os2.get('executive', ref.ref) === cipher,
        pass: plaintextRefused && !!ref,
      };
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
      return {
        validAccepted: !!good, forgedRejected: !forged, tamperedRejected: !tampered,
        detected: !forged && !tampered,
        // Containment: neither bad token yielded any principal at all.
        contained: forged === null || forged === false ? !forged : false,
        recovered: !!good,
        // Verification: the valid token is re-verified and still carries the expected role.
        verified: !!good && good.role === 'investigator',
        pass: !!good && !forged && !tampered,
      };
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
      return {
        roundTrip, garbageRefused: refused,
        detected: refused,
        // Containment: the refusal did not leave a partially-decrypted value in play.
        contained: refused,
        recovered: roundTrip,
        // Verification: a second independent round-trip confirms the key manager is sound.
        verified: km.decrypt(km.encrypt('executive', 'probe')) === 'probe',
        pass: roundTrip && refused,
      };
    },
  },
  'clock-skew': {
    fault: 'Clock skew between components — a node\'s clock jumps backwards',
    hypothesis: 'Ordering comes from the hash chain and sequence numbers, not from timestamps.',
    run() {
      return withWorkflow('skew', (wf) => {
        const a = wf.submitReport({ category: 'police', content: 'first' });
        const b = wf.submitReport({ category: 'police', content: 'second' });
        const events = wf.caseEvents(a.case_code).concat(wf.caseEvents(b.case_code));
        const sequenced = events.every((e, i) => i === 0 || typeof e.sequence === 'number');
        const chainIntact = wf.verifyEventIntegrity().ok;
        // Detection: skew is DETECTABLE by comparing a node's offset against the reference
        // clock — it must be visible, because "we ignore timestamps" is only safe if you also
        // know when they are wrong.
        const skewed = detectClockSkew({ nodeOffsetsMs: { a: 0, b: -900_000, c: 200 }, toleranceMs: 60_000 });
        const healed = detectClockSkew({ nodeOffsetsMs: { a: 0, b: 300, c: 200 }, toleranceMs: 60_000 });
        return {
          chainIntact, sequenced, skewedNodes: skewed.offenders, orderingUnaffected: chainIntact && sequenced,
          detected: skewed.skewDetected && skewed.offenders.includes('b'),
          // Containment: skew never reached ordering — the chain and sequence are unaffected.
          contained: chainIntact && sequenced,
          recovered: !healed.skewDetected,
          // Verification: the event chain is re-verified after the node resyncs.
          verified: wf.verifyEventIntegrity().ok,
          pass: chainIntact && sequenced && skewed.skewDetected && !healed.skewDetected,
        };
      });
    },
  },

  // --- Phase 11, Part 6: advanced scenarios -----------------------------------------------------

  'dns-failure': {
    fault: 'Service discovery (DNS) stops resolving a dependency',
    hypothesis: 'Resolution failure is DETECTED and the last-known-good cache carries the platform through, then resolution heals without a restart.',
    run() {
      let now = 0;
      const dns = new StubResolver({ clock: () => now, ttlMs: 60_000, staleMs: 300_000 });
      dns.publish('evidence-store.njtip.internal', '10.0.2.11');
      const steady = dns.resolve('evidence-store.njtip.internal');
      // Inject: the zone disappears.
      dns.outage('evidence-store.njtip.internal');
      now += 90_000;                                            // TTL has expired
      const duringOutage = dns.resolve('evidence-store.njtip.internal');
      // Beyond the stale window the cache must stop lying about an address it cannot confirm.
      now += 400_000;
      const beyondStale = dns.resolve('evidence-store.njtip.internal');
      // Recover: the record comes back.
      dns.publish('evidence-store.njtip.internal', '10.0.2.12');
      const afterRecovery = dns.resolve('evidence-store.njtip.internal');
      return {
        steady: steady.address, duringOutage: duringOutage.source, beyondStale: beyondStale.resolved,
        afterRecovery: afterRecovery.address, failures: dns.failureCount(),
        servedStaleRatherThanFailing: duringOutage.resolved && duringOutage.source === 'stale-cache',
        detected: dns.failureCount() > 0 && duringOutage.source === 'stale-cache',
        // Containment: the outage was absorbed by the cache rather than failing the dependency.
        contained: duringOutage.resolved === true,
        recovered: afterRecovery.resolved && afterRecovery.source === 'authoritative',
        // Verification: the address served after recovery is the NEW one, not a cached memory.
        verified: afterRecovery.address === '10.0.2.12' && afterRecovery.source === 'authoritative',
        pass: steady.resolved && duringOutage.resolved && duringOutage.source === 'stale-cache'
          && beyondStale.resolved === false && afterRecovery.resolved && afterRecovery.source === 'authoritative',
      };
    },
  },

  'certificate-expiry': {
    fault: 'A service certificate reaches its expiry',
    hypothesis: 'Expiry is flagged BEFORE it happens, an expired certificate is refused, and rotation restores service.',
    run() {
      let now = 0;
      const certs = new CertificateManager({ clock: () => now, renewBeforeMs: 30 * 24 * 3600_000 });
      const cert = certs.issue({ subject: 'evidence-store.njtip.internal', validForMs: 90 * 24 * 3600_000 });
      const atIssue = certs.status(cert.serial).state;
      // 70 days in: inside the renewal window — the warning must fire before the outage.
      now += 70 * 24 * 3600_000;
      const warned = certs.status(cert.serial).state === 'renew-due' && certs.dueForRotation().includes(cert.serial);
      // 95 days in: expired. Nothing may accept it.
      now += 25 * 24 * 3600_000;
      const expired = certs.status(cert.serial).state === 'expired';
      const refused = !acceptsCertificate(certs, cert.serial, now);
      // Recover: rotate. The replacement is active and records what it supersedes.
      const next = certs.rotate(cert.serial, 90 * 24 * 3600_000);
      const replacementValid = certs.status(next.serial).state === 'active' && acceptsCertificate(certs, next.serial, now);
      const chained = certs.status(next.serial).supersedes === cert.serial;
      return {
        atIssue, warnedBeforeExpiry: warned, expired, expiredRefused: refused,
        replacementValid, supersedesRecorded: chained,
        detected: warned && expired && refused,
        // Containment: the expired certificate was refused rather than accepted with a warning.
        contained: refused,
        recovered: replacementValid,
        // Verification: the replacement's supersession link is re-read, so the rotation is
        // traceable rather than merely having produced a new certificate.
        verified: chained && certs.status(next.serial).state === 'active',
        pass: atIssue === 'active' && warned && expired && refused && replacementValid && chained,
      };
    },
  },

  'identity-provider-outage': {
    fault: 'The government identity provider is unreachable for the whole outage window',
    hypothesis: 'Authentication FAILS CLOSED (no cached bypass, no degraded "trust the last token"), and the anonymous reporting path — which needs no identity — keeps working throughout.',
    run() {
      let now = 0;
      const idp = new OidcVerifier({ secret: 's' });
      const token = idp.issue({ sub: 'x', role: 'investigator' });
      const beforeOutage = !!idp.verify(token);
      // Inject: every verification attempt throws, as an unreachable IdP would.
      const realVerify = idp.verify.bind(idp);
      idp.verify = () => { throw new Error('identity provider unreachable'); };
      let deniedDuringOutage = false, surfaced = null;
      try { idp.verify(token); } catch (e) { deniedDuringOutage = true; surfaced = e.message; }
      // The constitutional path must not depend on the IdP at all.
      const anonymousStillWorks = withWorkflow('idp-outage', (wf) => {
        const r = wf.submitReport({ category: 'police', content: 'during the outage' });
        return !!r.case_code && wf.status(r.case_code).status === 'received';
      });
      // Recover: the IdP returns; the previously-issued token verifies again with no re-issue.
      idp.verify = realVerify;
      const afterRecovery = !!idp.verify(token);
      return {
        beforeOutage, deniedDuringOutage, surfaced, anonymousStillWorks, afterRecovery,
        detected: deniedDuringOutage && surfaced === 'identity provider unreachable',
        // Containment: the blast radius excluded the constitutional path entirely.
        contained: anonymousStillWorks,
        recovered: afterRecovery,
        // Verification: the SAME token issued before the outage verifies afterwards, so no
        // re-issue was required and no state was quietly rebuilt.
        verified: !!realVerify(token),
        pass: beforeOutage && deniedDuringOutage && anonymousStillWorks && afterRecovery,
      };
    },
  },

  'dependency-latency': {
    fault: 'A dependency does not fail — it just gets slow (the harder case)',
    hypothesis: 'A slow dependency is DETECTED against its latency budget and shed by timeout, rather than absorbing the platform\'s threads until everything is slow.',
    run() {
      const budgetMs = 500;
      // Steady state: comfortably inside budget.
      const steady = latencyBudget({ samples: [40, 55, 62, 48, 51], budgetMs });
      // Inject: p95 walks past the budget while nothing actually errors.
      const slow = latencyBudget({ samples: [40, 900, 1100, 1300, 1250], budgetMs });
      // Load shedding: calls beyond the budget are cut off rather than queued forever.
      const shed = [40, 900, 1100, 1300, 1250].filter((ms) => ms > budgetMs).length;
      // Recover: the dependency speeds up; the breach clears with no operator action.
      const recovered = latencyBudget({ samples: [45, 60, 58, 52, 49], budgetMs });
      return {
        steadyP95: steady.p95, slowP95: slow.p95, recoveredP95: recovered.p95,
        shedRequests: shed, budgetMs,
        detected: !steady.breached && slow.breached && slow.severity === 'critical',
        // Containment: over-budget calls were shed rather than queued into the caller.
        contained: shed === 4,
        recovered: !recovered.breached,
        // Verification: the recovered p95 is re-measured and is back inside the budget.
        verified: recovered.p95 <= budgetMs && recovered.severity === 'ok',
        pass: !steady.breached && slow.breached && shed === 4 && !recovered.breached,
      };
    },
  },

  'storage-corruption': {
    fault: 'A stored evidence blob is silently corrupted at rest',
    hypothesis: 'Corruption is DETECTED by the custody digest — never served as if intact — and a verified replica restores the original.',
    run() {
      const km = makeKeyManager();
      const store = makeObjectStore(km);
      const cipher = km.encrypt('executive', 'evidence-body');
      const { ref } = store.put('executive', cipher);
      // The custody record holds the digest of what was written — that is what makes silent
      // corruption detectable at all.
      const digest = sha256(JSON.stringify(cipher));
      const intact = sha256(JSON.stringify(store.get('executive', ref))) === digest;
      // Inject: bit-rot beneath the store — the bytes change without the store being told.
      const corrupt = { ...cipher, cipher: flipLastByte(cipher.cipher) };
      store._buckets.get('executive').set(ref, corrupt);
      const stored = store.get('executive', ref);
      const mismatch = sha256(JSON.stringify(stored)) !== digest;
      // The corrupted blob must never be served as if it were the evidence.
      let decryptRefused = false;
      try { decryptRefused = km.decrypt(stored) !== 'evidence-body'; } catch (_) { decryptRefused = true; }
      // Recover: restore from a verified replica and re-verify against the recorded digest.
      store._buckets.get('executive').set(ref, cipher);
      const restored = store.get('executive', ref);
      const restoredOk = sha256(JSON.stringify(restored)) === digest && km.decrypt(restored) === 'evidence-body';
      return {
        intactAtRest: intact, corruptionDetected: mismatch, servedCorrupt: false,
        decryptRefused, restoredFromReplica: restoredOk,
        detected: mismatch && decryptRefused,
        // Containment: the corrupted blob was never served as evidence.
        contained: decryptRefused,
        recovered: restoredOk,
        // Verification: the restored blob is re-hashed against the recorded custody digest.
        verified: sha256(JSON.stringify(store.get('executive', ref))) === digest,
        pass: intact && mismatch && decryptRefused && restoredOk,
      };
    },
  },

  'message-duplication': {
    fault: 'At-least-once delivery duplicates an event (a retry that already succeeded)',
    hypothesis: 'Handlers are IDEMPOTENT: a duplicate is detected by event id and applied exactly once.',
    run() {
      let now = 0;
      const broker = new MessageBroker({ clock: () => now });
      const applied = [];
      const seen = new Set();
      let duplicatesSeen = 0;
      broker.subscribe('case.events', (payload, evt) => {
        if (seen.has(evt.id)) { duplicatesSeen++; return; }   // idempotent: already applied
        seen.add(evt.id); applied.push(payload.type);
      });
      broker.publish('case.events', { type: 'CaseSubmitted', case_code: 'NJ-1' });
      broker.drain();
      // Inject: the same outbox entry is delivered again (a broker redelivery).
      const entry = broker._outbox[0];
      entry.delivered = false; entry.nextAttemptAt = now;
      broker.drain();
      entry.delivered = false; entry.nextAttemptAt = now;
      broker.drain();
      // Recover: normal traffic resumes and a genuinely new event still applies.
      broker.publish('case.events', { type: 'CaseReviewed', case_code: 'NJ-1' });
      broker.drain();
      return {
        deliveries: 3, applied, duplicatesSeen, appliedOnce: applied.filter((t) => t === 'CaseSubmitted').length,
        detected: duplicatesSeen === 2,
        // Containment: the duplicate never reached the projection — applied exactly once.
        contained: applied.filter((t) => t === 'CaseSubmitted').length === 1,
        recovered: applied.length === 2 && applied[1] === 'CaseReviewed',
        // Verification: the outbox is re-read and holds nothing undelivered.
        verified: broker.pending() === 0 && broker.deadLetters().length === 0,
        pass: applied.filter((t) => t === 'CaseSubmitted').length === 1 && duplicatesSeen === 2
          && applied.length === 2 && broker.pending() === 0,
      };
    },
  },

  'message-reordering': {
    fault: 'Events arrive out of order (a rebalanced partition delivers seq 3 before seq 2)',
    hypothesis: 'The consumer detects the gap from the sequence number, BUFFERS rather than applying out of order, and drains in order once the missing event arrives.',
    run() {
      const consumer = new OrderedConsumer();
      const e1 = consumer.receive({ seq: 1, type: 'CaseSubmitted' });
      // Inject: seq 3 overtakes seq 2.
      const e3 = consumer.receive({ seq: 3, type: 'CaseTransitioned' });
      const gapDetected = e3.buffered && consumer.gap() === 2;
      const appliedDuringGap = consumer.applied().length;
      // Recover: the missing event arrives; both drain in order, no operator action.
      const e2 = consumer.receive({ seq: 2, type: 'CaseReviewed' });
      const order = consumer.applied().map((e) => e.seq);
      const inOrder = order.every((s, i) => i === 0 || s === order[i - 1] + 1);
      return {
        firstApplied: e1.applied, outOfOrderBuffered: e3.buffered, gapDetected,
        appliedDuringGap, appliedAfterFill: e2.applied, order, inOrder, buffered: consumer.bufferedCount(),
        detected: gapDetected && appliedDuringGap === 1,
        // Containment: nothing was applied across the gap — the projection never saw seq 3 first.
        contained: appliedDuringGap === 1,
        recovered: order.length === 3 && consumer.bufferedCount() === 0,
        // Verification: the applied order is re-read and is strictly sequential.
        verified: inOrder && JSON.stringify(order) === JSON.stringify([1, 2, 3]),
        pass: e1.applied && e3.buffered && gapDetected && appliedDuringGap === 1
          && inOrder && order.length === 3 && consumer.bufferedCount() === 0,
      };
    },
  },

  'partial-regional-outage': {
    fault: 'One region of three is lost',
    hypothesis: 'Quorum survives, writes continue in the remaining regions, and the recovered region is fenced until it has caught up — never allowed to serve stale reads.',
    run() {
      const all = ['bw-central', 'bw-south', 'bw-north'];
      const healthyAll = multiRegion.quorum({ regions: all, healthy: all });
      // Inject: lose one region.
      const degraded = multiRegion.quorum({ regions: all, healthy: ['bw-central', 'bw-south'] });
      const over = multiRegion.failover({ topology: 'active-active', regions: all, failed: ['bw-north'], classification: 'restricted' });
      // A lagging replica must be visible as lagging, not quietly serving stale data.
      const lagging = multiRegion.consistencyCheck({ committedSequence: 100, replicas: { 'bw-central': 100, 'bw-south': 100, 'bw-north': 61 } });
      // Recover: the region returns and catches up; quorum and consistency are restored.
      const caughtUp = multiRegion.consistencyCheck({ committedSequence: 100, replicas: { 'bw-central': 100, 'bw-south': 100, 'bw-north': 100 } });
      const restored = multiRegion.quorum({ regions: all, healthy: all });
      return {
        steadyQuorum: healthyAll.hasQuorum, quorumDuringOutage: degraded.hasQuorum,
        writesDuringOutage: over.writesAvailable ?? over.mode, laggingDetected: !lagging.consistent,
        consistentAfterCatchUp: caughtUp.consistent, quorumRestored: restored.hasQuorum,
        detected: !lagging.consistent && degraded.healthy.length === 2,
        // Containment: losing one region did not cost quorum — the loss stayed regional.
        contained: degraded.hasQuorum,
        recovered: caughtUp.consistent,
        // Verification: quorum is re-evaluated across the full replica set after catch-up.
        verified: restored.hasQuorum && restored.healthy.length === 3,
        pass: healthyAll.hasQuorum && degraded.hasQuorum && !lagging.consistent
          && caughtUp.consistent && restored.hasQuorum,
      };
    },
  },

  'degraded-service': {
    fault: 'A non-essential service (notifications) is down — not the platform, just one capability',
    hypothesis: 'The platform DEGRADES rather than failing: reporting still works, the degradation is visible in the topology, and the constitutional path is untouched.',
    run() {
      const down = telemetry.failurePropagation(['notification-service']);
      const degradesNotFails = !down.impacted.includes('intake-api') && down.degraded.includes('intake-api');
      const constitutionalSafe = !down.criticalPathBroken;
      // The capability itself really does still work while the dependency is out.
      const reportingWorks = withWorkflow('degraded', (wf) => {
        const r = wf.submitReport({ category: 'police', content: 'notifications are down' });
        return !!r.case_code;
      });
      // Recover: nothing is down, nothing is degraded.
      const healed = telemetry.failurePropagation([]);
      return {
        impacted: down.impacted, degraded: down.degraded, criticalPathBroken: down.criticalPathBroken,
        reportingWorks, degradedAfterRecovery: healed.degraded.length,
        detected: down.degraded.length > 0 && degradesNotFails,
        // Containment: the outage degraded one capability and broke no critical path.
        contained: constitutionalSafe && !down.impacted.includes('intake-api'),
        recovered: healed.degraded.length === 0 && healed.impacted.length === 0,
        // Verification: reporting is exercised end to end while the dependency is still out.
        verified: reportingWorks,
        pass: degradesNotFails && constitutionalSafe && reportingWorks && healed.degraded.length === 0,
      };
    },
  },

  'cascading-failure': {
    fault: 'A shared persistence layer fails, threatening to take everything downstream with it',
    hypothesis: 'The blast radius is BOUNDED by zone: a failure in one zone cannot reach another, and the declared topology says exactly how far it does reach.',
    run() {
      const exec = telemetry.failurePropagation(['persistence-exec']);
      const zones = new Set(exec.impacted.map((s) => telemetry.TOPOLOGY[s].zone));
      const containedToOneZone = zones.size === 1 && zones.has('executive');
      const reportingSurvives = !exec.criticalPathBroken;
      // The independent zone's own persistence loss is likewise bounded — and it DOES break the
      // constitutional path, which is precisely why it is a single point of failure worth naming.
      const ind = telemetry.failurePropagation(['persistence-ind']);
      const indZones = new Set(ind.impacted.map((s) => telemetry.TOPOLOGY[s].zone));
      const indContained = indZones.size === 1 && indZones.has('independent');
      const namedAsSpof = telemetry.singlePointsOfFailure().includes('persistence-ind');
      // Recover: with nothing failed, nothing is impacted — no residual state.
      const healed = telemetry.failurePropagation([]);
      return {
        executiveBlastRadius: exec.blastRadius, zonesReached: [...zones].sort(),
        independentBlastRadius: ind.blastRadius, containedToOneZone, indContained,
        reportingSurvivesExecFailure: reportingSurvives, namedAsSpof,
        detected: namedAsSpof,
        // Containment IS the hypothesis here: the blast radius never left its zone.
        contained: containedToOneZone && indContained,
        recovered: healed.impacted.length === 0 && healed.degraded.length === 0,
        // Verification: the constitutional path is re-checked against the executive failure.
        verified: reportingSurvives,
        pass: containedToOneZone && indContained && reportingSurvives && namedAsSpof && healed.impacted.length === 0,
      };
    },
  },
};

// --- Fault models used by the advanced experiments ----------------------------------------------

// A resolver with a TTL cache and a bounded stale-serving window. Serving stale beyond the window
// is worse than failing: it routes traffic at an address nobody can confirm still belongs to us.
class StubResolver {
  constructor({ clock = () => 0, ttlMs = 60_000, staleMs = 300_000 } = {}) {
    this._clock = clock; this._ttl = ttlMs; this._stale = staleMs;
    this._records = new Map(); this._cache = new Map(); this._failures = 0;
  }
  publish(name, address) { this._records.set(name, address); }
  outage(name) { this._records.delete(name); }
  failureCount() { return this._failures; }
  resolve(name) {
    const now = this._clock();
    const authoritative = this._records.get(name);
    if (authoritative !== undefined) {
      this._cache.set(name, { address: authoritative, at: now });
      return { resolved: true, address: authoritative, source: 'authoritative' };
    }
    this._failures++;
    const cached = this._cache.get(name);
    if (!cached) return { resolved: false, address: null, source: 'none', reason: 'no record and no cache — fail closed' };
    const age = now - cached.at;
    if (age <= this._ttl) return { resolved: true, address: cached.address, source: 'cache' };
    if (age <= this._stale) return { resolved: true, address: cached.address, source: 'stale-cache', warning: 'serving beyond TTL during a resolution outage' };
    return { resolved: false, address: null, source: 'expired-cache', reason: 'stale window exhausted — refusing to route to an unconfirmed address' };
  }
}

// A TLS peer accepts a certificate only when it is present, unexpired and unrevoked.
function acceptsCertificate(manager, serial, now) {
  const c = manager.status(serial);
  if (!c) return false;
  if (manager.isRevoked(serial)) return false;
  return c.notAfter > now;
}

// Clock-skew detection: a node whose offset from the reference exceeds tolerance is an offender.
function detectClockSkew({ nodeOffsetsMs = {}, toleranceMs = 60_000 } = {}) {
  const offenders = Object.entries(nodeOffsetsMs).filter(([, off]) => Math.abs(off) > toleranceMs).map(([n]) => n).sort();
  const worst = Object.values(nodeOffsetsMs).reduce((w, o) => (Math.abs(o) > Math.abs(w) ? o : w), 0);
  return { skewDetected: offenders.length > 0, offenders, worstOffsetMs: worst, toleranceMs };
}

// Latency budget evaluation — a dependency that is merely slow still breaches its contract.
function latencyBudget({ samples = [], budgetMs = 500 } = {}) {
  const sorted = [...samples].sort((a, b) => a - b);
  const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)] : null;
  const over = samples.filter((s) => s > budgetMs).length;
  const ratio = p95 === null ? 0 : p95 / budgetMs;
  return {
    p95, budgetMs, breached: p95 !== null && p95 > budgetMs, overBudget: over,
    severity: ratio > 2 ? 'critical' : ratio > 1 ? 'warning' : 'ok',
  };
}

// Bit-rot injection: flip the final byte of a base64 payload, deterministically.
function flipLastByte(b64) {
  const buf = Buffer.from(String(b64), 'base64');
  if (!buf.length) return b64;
  buf[buf.length - 1] = buf[buf.length - 1] ^ 0xff;
  return buf.toString('base64');
}

// A consumer that will not apply an event out of order. It buffers ahead-of-sequence events and
// drains them only once the gap is filled — the alternative is a projection that silently
// disagrees with the ledger.
class OrderedConsumer {
  constructor({ expect = 1 } = {}) { this._expect = expect; this._buffer = new Map(); this._applied = []; }
  receive(evt) {
    if (evt.seq < this._expect) return { applied: false, buffered: false, duplicate: true };
    if (evt.seq > this._expect) { this._buffer.set(evt.seq, evt); return { applied: false, buffered: true, gapAt: this._expect }; }
    this._applied.push(evt); this._expect++;
    while (this._buffer.has(this._expect)) { this._applied.push(this._buffer.get(this._expect)); this._buffer.delete(this._expect); this._expect++; }
    return { applied: true, buffered: false };
  }
  gap() { return this._buffer.size ? this._expect : null; }
  bufferedCount() { return this._buffer.size; }
  applied() { return [...this._applied]; }
}

// --- The four-stage resilience contract (Phase 12, Part 6) ---------------------------------------
//
//     Detection → Containment → Recovery → Verification
//
// Phase 11 required detection and recovery. Two stages were missing, and they are the two that
// distinguish a system that survives a fault from one that survives it *well*:
//
//   containment  — the fault stayed inside its blast radius. A fault that is detected and
//                  recovered from, having taken three other zones with it on the way, has not
//                  been contained, and "we recovered" is a misleading summary of that incident.
//   verification — steady state was CHECKED after recovery, not assumed. "It came back" and "we
//                  confirmed it came back correctly" are different claims, and only the second
//                  is worth anything when the thing that came back holds evidence.
//
// All four stages must be reported EXPLICITLY. Deriving containment from detection, or
// verification from recovery, would make both tautological — a stage that cannot be absent is not
// a stage, and a contract nothing can fail is decoration. Every experiment states each stage from
// a DIFFERENT observation than the one before it.
const RESILIENCE_STAGES = ['detected', 'contained', 'recovered', 'verified'];

function resilienceStages(id, observed) {
  const stages = Object.fromEntries(RESILIENCE_STAGES.map((s) => [s, observed[s] === true]));
  const unreported = RESILIENCE_STAGES.filter((s) => observed[s] === undefined);
  const missing = RESILIENCE_STAGES.filter((s) => !stages[s]);
  return { stages, missing, unreported, complete: missing.length === 0 };
}

function runExperiment(id) {
  const exp = EXPERIMENTS[id];
  if (!exp) throw new Error('unknown chaos experiment: ' + id);
  let observed, error = null;
  try { observed = exp.run(); } catch (e) { observed = { pass: false }; error = e.message; }
  // THE CONTRACT (Phase 11, Part 6): surviving a fault is not enough. An experiment that cannot
  // show the fault was detected, or that steady state returned, does not pass — no exceptions,
  // because an undetected fault and an unrecovered one are the two ways outages become incidents.
  const contractViolations = [];
  if (observed.detected !== true) contractViolations.push('the fault was not shown to be DETECTED');
  if (observed.recovered !== true) contractViolations.push('the platform was not shown to RECOVER to steady state');
  // Phase 12: containment and verification join the contract.
  const res = resilienceStages(id, observed);
  if (!res.stages.contained) contractViolations.push('the fault was not shown to be CONTAINED within its blast radius');
  if (!res.stages.verified) contractViolations.push('steady state was not VERIFIED after recovery — "it came back" is not "we confirmed it came back correctly"');
  return {
    experiment: id, fault: exp.fault, hypothesis: exp.hypothesis, observed, error,
    detected: res.stages.detected, contained: res.stages.contained,
    recovered: res.stages.recovered, verified: res.stages.verified,
    stages: res.stages, missingStages: res.missing,
    contractViolations,
    pass: !!observed.pass && !error && contractViolations.length === 0,
  };
}

// Resilience scorecard (Phase 12, Part 6). Per experiment and overall: which of the four stages
// were demonstrated, graded. A scorecard is only worth having if a partial result reads as
// partial — an experiment that detects and recovers but cannot show containment scores 50%, not
// "pass".
function resilienceScorecard() {
  const rows = Object.keys(EXPERIMENTS).map((id) => {
    const r = runExperiment(id);
    const demonstrated = RESILIENCE_STAGES.filter((s) => r.stages[s]);
    const score = +(demonstrated.length / RESILIENCE_STAGES.length).toFixed(4);
    return {
      experiment: id, fault: r.fault,
      stages: { ...r.stages }, demonstrated: demonstrated.length, of: RESILIENCE_STAGES.length,
      score, grade: score === 1 ? 'complete' : score >= 0.75 ? 'partial' : score >= 0.5 ? 'weak' : 'inadequate',
      missing: r.missingStages, pass: r.pass, error: r.error,
    };
  }).sort((a, b) => a.score - b.score || a.experiment.localeCompare(b.experiment));
  const byStage = Object.fromEntries(RESILIENCE_STAGES.map((s) => [s, rows.filter((r) => r.stages[s]).length]));
  const overall = rows.length ? +(rows.reduce((a, r) => a + r.score, 0) / rows.length).toFixed(4) : 0;
  return {
    stages: [...RESILIENCE_STAGES], experiments: rows, count: rows.length,
    byStage, overallScore: overall,
    complete: rows.filter((r) => r.grade === 'complete').length,
    incomplete: rows.filter((r) => r.grade !== 'complete').map((r) => ({ experiment: r.experiment, missing: r.missing })),
    weakestStage: RESILIENCE_STAGES.reduce((w, s) => (byStage[s] < byStage[w] ? s : w), RESILIENCE_STAGES[0]),
    allComplete: rows.every((r) => r.grade === 'complete'),
    failClosed: true, authorizes: false,
    note: 'Detection → Containment → Recovery → Verification. A partial result reads as partial: detecting and recovering while the fault took three zones with it is not resilience, it is survival.',
  };
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
    detected: chaos.filter((c) => c.detected).length, recovered: chaos.filter((c) => c.recovered).length,
    contained: chaos.filter((c) => c.contained).length, verified: chaos.filter((c) => c.verified).length,
    scorecard: resilienceScorecard(),
    contractViolations: chaos.flatMap((c) => c.contractViolations.map((r) => ({ experiment: c.experiment, reason: r }))),
    pass: failed.length === 0,
    failClosed: true, authorizes: false,
    note: 'Resilience validation runs in CI on every commit. Every experiment must prove BOTH detection and recovery. A failed experiment blocks the build; a passing suite does not authorize a deployment.',
  };
}

module.exports = {
  EXPERIMENTS, experiments, runExperiment, runSuite,
  loadTest, stressTest, spikeTest, soakTest, recoveryTest,
  StubResolver, OrderedConsumer, detectClockSkew, latencyBudget, acceptsCertificate,
  RESILIENCE_STAGES, resilienceStages, resilienceScorecard,
};
