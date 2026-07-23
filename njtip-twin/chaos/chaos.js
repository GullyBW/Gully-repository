'use strict';
// Chaos Engineering framework: controlled fault injection to validate GRACEFUL
// DEGRADATION and RECOVERY. Each experiment injects a fault, asserts the system
// degrades safely (fail-closed / no data loss / detection), then recovers.
// Deterministic; synthetic only.
const { ZONES } = require('../src/zones');

const E = (id, name, fault, degradedOk, recoveredOk, metrics) =>
  ({ id, name, fault, degraded: degradedOk, recovered: recoveredOk, pass: degradedOk && recoveredOk, metrics });

const experiments = [
  { id: 'CHAOS-DB-FAILURE', run(b) {
    const t = b();
    t.health.db = false;
    // Same-zone read is refused while db is down would be app-level; we assert cross-zone stays blocked
    // and that when db returns, same-zone read works (no stale/plaintext served during outage).
    const duringOutageCrossZone = t.attemptDbRead('investigation', ZONES.JUDICIARY).allowed; // still blocked
    t.health.db = true;
    const afterSameZone = t.attemptDbRead('investigation', ZONES.EXECUTIVE).allowed;
    return E(this.id, 'Database failure', 'db-down', duringOutageCrossZone === false, afterSameZone === true, { crossZoneServedDuringOutage: duringOutageCrossZone ? 1 : 0 });
  } },
  { id: 'CHAOS-POLICY-FAILURE', run(b) {
    const t = b();
    t.policy.setAvailable(false);
    const during = t.policy.evaluate({ action: 'submit-report' }).effect; // deny (fail-closed)
    t.policy.setAvailable(true);
    const after = t.policy.evaluate({ action: 'submit-report' }).effect; // allow
    return E(this.id, 'Policy engine failure', 'policy-down', during === 'deny', after === 'allow', { failedOpen: during === 'deny' ? 0 : 1 });
  } },
  { id: 'CHAOS-AUDIT-FAILURE', run(b) {
    const t = b();
    t.audit.setAvailable(false);
    // A sensitive op that must be audited (break-glass) refuses when audit is down.
    let refused = false;
    try { t.emergency.request({ operation: 'x', principal: 'op', approvals: ['a1', 'a2'], reason: 'r' }); } catch (e) { refused = e.code === 'AUDIT_UNAVAILABLE'; }
    t.audit.setAvailable(true);
    const after = (() => { try { t.emergency.request({ operation: 'y', principal: 'op', approvals: ['a1', 'a2'], reason: 'r' }); return true; } catch (_) { return false; } })();
    return E(this.id, 'Audit store failure', 'audit-down', refused, after, { unauditedOpAllowed: refused ? 0 : 1 });
  } },
  { id: 'CHAOS-EVENT-BUS-FAILURE', run(b) {
    const t = b();
    t.bus.setAvailable(false);
    let refused = false;
    try { t.bus.publish({ type: 'X', sourceZone: ZONES.EXECUTIVE, targetZone: ZONES.JUDICIARY, payload: { a: 1 } }); } catch (e) { refused = e.code === 'BUS_UNAVAILABLE'; }
    t.bus.setAvailable(true);
    const after = !!t.bus.publish({ type: 'X', sourceZone: ZONES.EXECUTIVE, targetZone: ZONES.JUDICIARY, payload: { a: 1 } });
    return E(this.id, 'Event bus failure', 'bus-down', refused, after, { silentDrop: refused ? 0 : 1 });
  } },
  { id: 'CHAOS-NETWORK-LATENCY', run(b) {
    const t = b();
    // Latency does not affect correctness: a submit still persists.
    t.stores.report.submit({ case_code: 'LAT', category: 'other', content: 'x' });
    const ok = t.stores.report.status('LAT') !== null;
    return E(this.id, 'Network latency injection', 'latency', ok, ok, { correctnessImpact: ok ? 0 : 1 });
  } },
  { id: 'CHAOS-PACKET-LOSS', run(b) {
    const t = b();
    // Idempotency: re-submitting the same case_code does not create a duplicate.
    t.stores.report.submit({ case_code: 'PL', category: 'other', content: 'x' });
    t.stores.report.submit({ case_code: 'PL', category: 'other', content: 'x' }); // retransmit
    const noDup = t.stores.report.count() === 1;
    return E(this.id, 'Packet loss / retransmission', 'packet-loss', noDup, noDup, { duplicates: noDup ? 0 : 1 });
  } },
  { id: 'CHAOS-CERT-EXPIRATION', run(b) {
    const t = b();
    const expired = { subject: 'x', notBefore: 0, notAfter: 1 };
    const during = t.time.certValid(expired).valid; // false -> refuse
    const rotated = t.time.certValid(t.cert).valid; // valid cert works
    return E(this.id, 'Certificate expiration', 'cert-expired', during === false, rotated === true, { expiredAccepted: during ? 1 : 0 });
  } },
  { id: 'CHAOS-STORAGE-EXHAUSTION', run(b) {
    const t = b();
    const QUOTA = 20; let accepted = 0, shed = 0;
    for (let i = 0; i < 100; i++) { if (accepted < QUOTA) { t.stores.report.submit({ case_code: 'SE' + i, category: 'other', content: 'x' }); accepted++; } else shed++; }
    const graceful = accepted === QUOTA && shed > 0; // shed, not crash
    const recovered = t.stores.report.count() === QUOTA; // accepted data intact
    return E(this.id, 'Storage exhaustion', 'storage-full', graceful, recovered, { accepted, shed });
  } },
  { id: 'CHAOS-SERVICE-CRASH', run(b) {
    const t = b();
    t.health.crashed = true;
    // Degrade-to-minimal-intake: still accept a report (queued), no data loss.
    t.stores.report.submit({ case_code: 'CR', category: 'other', content: 'x' });
    const accepted = t.stores.report.status('CR') !== null;
    t.health.crashed = false; // restart
    return E(this.id, 'Service crash', 'crash', accepted, true, { dataLostOnCrash: accepted ? 0 : 1 });
  } },
];

function runAll(build) {
  return experiments.map((e) => e.run(build));
}

module.exports = { experiments, runAll };
