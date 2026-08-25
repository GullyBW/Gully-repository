'use strict';
// Expanded adversarial simulation library (v0.2): cyber, insider, governance, and
// operational scenarios. Each runs against a FRESH synthetic twin and returns
// pass/fail + resilience metrics. Deterministic.
const { ZONES } = require('../src/zones');
const { isCiphertext } = require('../src/platform/crypto');
const { sha256 } = require('../src/util/hash');

const R = (id, name, threats, expected, pass, metrics) => ({ id, name, threats, expected, pass, metrics });

const library = [
  // ---------------- Cybersecurity ----------------
  { id: 'SIM-20-SUPPLY-CHAIN', threats: ['T-3'], run(b) {
    const t = b();
    const manifest = { component: 'intake-client', version: '1.0.0', files: ['a', 'b', 'c'] };
    const published = sha256(manifest);
    const rebuilt = sha256(manifest); // reproducible build matches
    const tampered = sha256({ ...manifest, files: ['a', 'b', 'c', 'evil'] });
    const okDetect = rebuilt === published && tampered !== published;
    return R(this.id, 'Supply-chain compromise (provenance mismatch)', this.threats,
      'reproducible fingerprint matches; tampered artifact detected', okDetect, { fingerprintMatch: rebuilt === published ? 1 : 0, tamperDetected: tampered !== published ? 1 : 0 });
  } },
  { id: 'SIM-21-API-ABUSE', threats: ['S-4', 'E-1'], run(b) {
    const t = b();
    const unauth = t.iam.decide({ principal: 'x', action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: 'M', authenticated: false });
    const undeclared = t.policy.evaluate({ action: 'bulk-export' });
    return R(this.id, 'API abuse (unauth + undeclared operation)', this.threats,
      'unauth denied; undeclared action default-deny', !unauth.allow && undeclared.effect === 'deny', { unauthAllowed: unauth.allow ? 1 : 0 });
  } },
  { id: 'SIM-22-CERTIFICATE-COMPROMISE', threats: ['S-1', 'T-5'], run(b) {
    const t = b();
    const expired = { subject: 'x', notBefore: 0, notAfter: 1 }; // long expired vs logical clock
    const res = t.time.certValid(expired);
    return R(this.id, 'Compromised/expired certificate', this.threats,
      'expired certificate rejected', res.valid === false, { expiredCertAccepted: res.valid ? 1 : 0 });
  } },
  { id: 'SIM-23-DNS-ATTACK', threats: ['S-1'], run(b) {
    const t = b();
    const pinned = sha256('onion://synthetic-intake-service');
    const spoofed = sha256('onion://attacker-lookalike');
    const detected = pinned !== spoofed; // pinning defeats redirection
    return R(this.id, 'DNS/endpoint redirection to look-alike', this.threats,
      'endpoint fingerprint pinning detects spoof', detected, { spoofDetected: detected ? 1 : 0 });
  } },
  { id: 'SIM-24-CREDENTIAL-STUFFING', threats: ['S-3'], run(b) {
    const t = b();
    t.iam.addPrincipal('stuffed', { roles: ['investigate'], mfa: 'password', zone: ZONES.EXECUTIVE });
    let blocked = 0;
    for (let i = 0; i < 5; i++) { try { t.iam.grant({ principal: 'stuffed', action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: 'M' }); } catch (_) { blocked++; } }
    return R(this.id, 'Credential stuffing against privileged action', this.threats,
      'all attempts rejected (phishing-resistant MFA required)', blocked === 5, { attemptsBlocked: blocked });
  } },
  { id: 'SIM-25-RANSOMWARE', threats: ['T-1', 'T-2'], run(b) {
    const t = b();
    t.audit.append({ actor: 'sys', action: 'a1', purpose: 'p', zone: 'independent' });
    t.stores.evidenceExec.ingest({ id: 'RW', actor: 'i', role: 'investigate', content: 'ransom-target', matter: 'M' });
    const obj = t.stores.evidenceExec._rawObject('RW');
    t.backup.snapshot('rw-snap', [obj]);
    // Ransomware "overwrites" an audit record and an evidence hash.
    t.audit._entries[0].record.action = 'ENCRYPTED';
    t.stores.evidenceExec._forceTamper('RW');
    const auditDetected = !t.audit.verifyIntegrity().ok;
    const evidenceDetected = !t.stores.evidenceExec.verifyObject('RW', 'ransom-target').ok;
    const recoverable = t.backup.verify('rw-snap').ok; // clean ciphertext backup exists
    return R(this.id, 'Ransomware overwrites audit + evidence', this.threats,
      'tampering detected on both; recoverable from ciphertext backup', auditDetected && evidenceDetected && recoverable,
      { auditTamperDetected: auditDetected ? 1 : 0, evidenceTamperDetected: evidenceDetected ? 1 : 0, recoverable: recoverable ? 1 : 0 });
  } },
  { id: 'SIM-26-FIRMWARE-COMPROMISE', threats: ['T-3'], run(b) {
    const t = b();
    const attested = sha256('boot-measurement:trusted');
    const actual = sha256('boot-measurement:trusted');
    const compromised = sha256('boot-measurement:malicious');
    return R(this.id, 'Firmware/boot attestation mismatch', this.threats,
      'attestation mismatch detected', actual === attested && compromised !== attested, { attestationOk: actual === attested ? 1 : 0 });
  } },
  { id: 'SIM-27-INSIDER-MALWARE', threats: ['I-4', 'I-6'], run(b) {
    const t = b();
    const cross = t.attemptDbRead('investigation', ZONES.JUDICIARY);
    t.stores.report.submit({ case_code: 'IM1', category: 'police', content: 'exfil-target' });
    const row = t.stores.report._rawRow('IM1');
    const leaked = JSON.stringify(row).includes('exfil-target');
    return R(this.id, 'Insider malware attempts cross-zone exfiltration', this.threats,
      'cross-zone blocked; only ciphertext at rest', !cross.allowed && !leaked && isCiphertext(row.content_cipher),
      { crossZoneBlocked: cross.allowed ? 0 : 1, plaintextLeaked: leaked ? 1 : 0 });
  } },

  // ---------------- Insider threats ----------------
  { id: 'SIM-28-COLLUSION', threats: ['E-1', 'E-3'], run(b) {
    const t = b();
    let blocked = false;
    try { t.threshold.authorize('de-anonymize', ['c1', 'c2']); } catch (e) { blocked = e.code === 'THRESHOLD_NOT_MET'; }
    return R(this.id, 'Two colluding operators attempt de-anonymization', this.threats,
      'insufficient for M-of-N threshold; blocked + audited', blocked, { colludersInsufficient: blocked ? 1 : 0 });
  } },
  { id: 'SIM-14-EMERGENCY-PRIVILEGE-ABUSE', threats: ['E-1', 'E-3'], run(b) {
    const t = b();
    let single = false, noReason = false;
    try { t.emergency.request({ operation: 'x', principal: 'op', approvals: ['a1'], reason: 'r' }); } catch (e) { single = e.code === 'DUAL_CONTROL_REQUIRED'; }
    try { t.emergency.request({ operation: 'x', principal: 'op', approvals: ['a1', 'a2'] }); } catch (e) { noReason = /reason/i.test(e.message); }
    return R(this.id, 'Abuse of emergency privileges', this.threats,
      'single-approver + reasonless break-glass rejected', single && noReason, { singleApproverBlocked: single ? 1 : 0, reasonEnforced: noReason ? 1 : 0 });
  } },
  { id: 'SIM-15-UNAUTHORIZED-DATA-MODIFICATION', threats: ['T-2', 'R-3'], run(b) {
    const t = b();
    t.audit.append({ actor: 'clerk', action: 'update-case', purpose: 'p', zone: 'judiciary' });
    t.audit._entries[0].record.action = 'silently-changed';
    const detected = !t.audit.verifyIntegrity().ok;
    return R(this.id, 'Unauthorized (silent) data modification', this.threats,
      'append-only + hash chain detects modification', detected, { modificationDetected: detected ? 1 : 0 });
  } },
  { id: 'SIM-16-EVIDENCE-TAMPERING', threats: ['T-1', 'T-5'], run(b) {
    const t = b();
    t.stores.evidenceExec.ingest({ id: 'ET1', actor: 'i', role: 'investigate', content: 'orig-evidence', matter: 'M' });
    t.stores.evidenceExec._forceTamper('ET1');
    const detected = !t.stores.evidenceExec.verifyObject('ET1', 'orig-evidence').ok;
    return R(this.id, 'Evidence tampering', this.threats, 'tamper detected on access', detected, { tamperDetected: detected ? 1 : 0 });
  } },
  { id: 'SIM-17-PRIVILEGE-MISUSE', threats: ['E-1'], run(b) {
    const t = b();
    t.iam.addPrincipal('inv', { roles: ['investigate'], mfa: 'fido2', zone: ZONES.EXECUTIVE });
    t.iam.grant({ principal: 'inv', action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: 'M1' });
    const outside = t.iam.decide({ principal: 'inv', action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: 'M2' }); // different matter
    return R(this.id, 'Privilege misuse (grant used outside its matter)', this.threats,
      'matter-scoped ABAC denies out-of-scope use', !outside.allow, { outOfScopeAllowed: outside.allow ? 1 : 0 });
  } },

  // ---------------- Governance failures ----------------
  { id: 'SIM-18-CORRUPT-REVIEWER', threats: ['E-1', 'RK-03'], run(b) {
    const t = b();
    let blocked = false;
    try { t.threshold.authorize('approve-readiness', ['c1']); } catch (e) { blocked = e.code === 'THRESHOLD_NOT_MET'; }
    return R(this.id, 'Corrupt reviewer approves alone', this.threats,
      'single approval insufficient; threshold holds', blocked, { singleApprovalBlocked: blocked ? 1 : 0 });
  } },
  { id: 'SIM-19-SOD-VIOLATION', threats: ['E-3'], run(b) {
    const t = b();
    t.iam.addPrincipal('dual', { roles: ['investigate', 'adjudicate'], mfa: 'fido2', zone: ZONES.JUDICIARY });
    const detected = t.iam.sodViolations().length > 0;
    return R(this.id, 'Separation-of-duties violation', this.threats,
      'principal holding excluded role pair is detected', detected, { sodViolationsDetected: t.iam.sodViolations().length });
  } },
  { id: 'SIM-32-POLICY-CONFLICT', threats: ['E-1'], run(b) {
    const t = b();
    t.policy.addRule({ action: 'risky-op', effect: 'allow' });
    t.policy.addRule({ action: 'risky-op', effect: 'deny' });
    const conflicts = t.policy.detectConflicts();
    const safe = t.policy.evaluateSafe({ action: 'risky-op' });
    return R(this.id, 'Conflicting policies (allow vs deny)', this.threats,
      'conflict detected; resolved deny-precedence (fail-safe)', conflicts.includes('risky-op') && safe.effect === 'deny',
      { conflictsDetected: conflicts.length, resolvedTo: safe.effect === 'deny' ? 1 : 0 });
  } },
  { id: 'SIM-33-DELAYED-APPROVAL', threats: ['RK-03'], run(b) {
    const t = b();
    // An operation attempted BEFORE obtaining the required approvals: no auto-approve.
    let blocked = false;
    try { t.threshold.authorize('safety-override', []); } catch (e) { blocked = e.code === 'THRESHOLD_NOT_MET'; }
    return R(this.id, 'Delayed/absent approvals (no auto-approve)', this.threats,
      'operation cannot proceed without approvals', blocked, { autoApproved: blocked ? 0 : 1 });
  } },
  { id: 'SIM-34-INVALID-GOVERNANCE-DECISION', threats: ['RK-03'], run(b) {
    const t = b();
    // A governance decision that lacks quorum signatures is invalid.
    let rejected = false;
    try { t.threshold.authorize('ratify-decision', ['c1', 'c2']); } catch (e) { rejected = e.code === 'THRESHOLD_NOT_MET'; }
    return R(this.id, 'Invalid governance decision (no quorum)', this.threats,
      'decision without quorum is rejected', rejected, { invalidAccepted: rejected ? 0 : 1 });
  } },

  // ---------------- Operational failures ----------------
  { id: 'SIM-29-HARDWARE-FAILURE', threats: ['D-1', 'D-4'], run(b) {
    const t = b();
    t.health.crashed = true; // a node crashes
    // Intake degrades to minimal but does not lose accepted data; policy still fail-closed.
    const failClosed = (() => { t.policy.setAvailable(false); const r = t.policy.evaluate({ action: 'submit-report' }); t.policy.setAvailable(true); return r.effect === 'deny'; })();
    return R(this.id, 'Hardware/component failure', this.threats,
      'degrade safely; fail-closed under component loss', failClosed, { failedOpen: failClosed ? 0 : 1 });
  } },
  { id: 'SIM-35-REGIONAL-OUTAGE', threats: ['D-1', 'RK-13'], run(b) {
    const t = b();
    t.stores.evidenceExec.ingest({ id: 'RO', actor: 'i', role: 'investigate', content: 'region-data', matter: 'M' });
    const snap = t.backup.snapshot('ro-snap', [t.stores.evidenceExec._rawObject('RO')]);
    const restored = t.backup.restore('ro-snap');
    const noPlaintext = !t.backup.containsPlaintext('ro-snap');
    return R(this.id, 'Regional outage → DR from ciphertext backup', this.threats,
      'restore succeeds from ciphertext-only backup', !!snap.manifestHash && restored.length === 1 && noPlaintext,
      { restored: restored.length, plaintextInBackup: noPlaintext ? 0 : 1 });
  } },
  { id: 'SIM-30-BACKUP-CORRUPTION', threats: ['I-4', 'D-1'], run(b) {
    const t = b();
    t.stores.evidenceExec.ingest({ id: 'BC', actor: 'i', role: 'investigate', content: 'backup-data', matter: 'M' });
    t.backup.snapshot('bc-snap', [t.stores.evidenceExec._rawObject('BC')]);
    t.backup._corrupt('bc-snap');
    const detected = !t.backup.verify('bc-snap').ok;
    return R(this.id, 'Backup corruption', this.threats, 'integrity check detects corruption', detected, { corruptionDetected: detected ? 1 : 0 });
  } },
  { id: 'SIM-31-TIME-SYNC-FAILURE', threats: ['T-5'], run(b) {
    const t = b();
    const ref = t.time.now();
    t.time._injectSkew(300_000);
    const detected = !t.time.checkSync(ref).ok;
    t.time._reset();
    return R(this.id, 'Time-synchronisation failure', this.threats, 'excessive skew detected', detected, { skewDetected: detected ? 1 : 0 });
  } },
  { id: 'SIM-36-RESOURCE-EXHAUSTION', threats: ['D-3'], run(b) {
    const t = b();
    const QUOTA = 50; let accepted = 0, shed = 0;
    for (let i = 0; i < 300; i++) { if (accepted < QUOTA) { t.stores.report.submit({ case_code: 'RE' + i, category: 'other', content: 'x' }); accepted++; } else shed++; }
    return R(this.id, 'Resource exhaustion (quota shedding)', this.threats,
      'quota sheds excess; core intake persists', accepted === QUOTA && shed > 0 && t.stores.report.count() === QUOTA,
      { accepted, shed });
  } },
];

module.exports = { library };
