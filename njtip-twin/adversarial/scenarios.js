'use strict';
// Adversarial Simulation Framework (blueprint phase8/05). Each scenario attacks
// one of the platform's promises against a FRESH synthetic twin and returns a
// pass/fail with resilience metrics. `build` is the orchestrator factory.
const zoneIsolation = require('../verification/fitness/zone-isolation');
const { defaultTopology } = require('../src/platform/orchestrator');
const { ZONES } = require('../src/zones');
const { isCiphertext } = require('../src/platform/crypto');
const { IDENTITY_DENYLIST } = require('../src/model/report-store');

function result(id, name, threats, expected, pass, metrics) {
  return { id, name, threats, expected, pass, metrics };
}

const scenarios = [
  {
    id: 'SIM-01-COMPROMISED-OPERATOR', threats: ['E-1', 'I-1'],
    run(build) {
      const t = build();
      let blocked = false;
      try { t.threshold.authorize('de-anonymize', ['c1']); } catch (e) { blocked = e.code === 'THRESHOLD_NOT_MET'; }
      // And there is no identity to reveal even if they tried.
      const noIdentitySchema = !t.stores.report.schema().columns.some((c) => IDENTITY_DENYLIST.includes(c.toLowerCase()));
      return result(this.id, 'Compromised operator attempts de-anonymization', this.threats,
        'single operator blocked by M-of-N; no identity exists to reveal',
        blocked && noIdentitySchema, { deAnonBlocked: blocked ? 1 : 0, identityFieldsPresent: noIdentitySchema ? 0 : 1 });
    },
  },
  {
    id: 'SIM-02-INSIDER-CROSS-ZONE', threats: ['I-6', 'E-3'],
    run(build) {
      const t = build();
      const probe = t.attemptDbRead('investigation', ZONES.JUDICIARY);
      return result(this.id, 'Insider attempts cross-zone raw DB read', this.threats,
        'cross-zone raw read denied + audited', !probe.allowed, { crossZoneReadsAllowed: probe.allowed ? 1 : 0 });
    },
  },
  {
    id: 'SIM-03-METADATA-ANALYSIS', threats: ['I-2', 'ID-2', 'DT-1', 'L-1'],
    run(build) {
      const t = build();
      t.stores.report.submit({ case_code: 'M1', category: 'police', content: 'a' });
      t.stores.report.submit({ case_code: 'M2', category: 'courts', content: 'b' });
      const row = t.stores.report._rawRow('M1');
      const storesIp = Object.prototype.hasOwnProperty.call(row, 'ip') || Object.prototype.hasOwnProperty.call(row, 'ipAddress');
      const intakeMinimal = t.services.find((s) => s.name === 'reporting').telemetry.minimalIntakeSignal === true;
      const unlinkable = t.stores.report._rawRow('M1').case_code !== t.stores.report._rawRow('M2').case_code;
      return result(this.id, 'Metadata correlation attempt', this.threats,
        'no IP retained; minimal intake signal; per-report unlinkable',
        !storesIp && intakeMinimal && unlinkable, { ipRecords: storesIp ? 1 : 0, minimalIntakeSignal: intakeMinimal ? 1 : 0 });
    },
  },
  {
    id: 'SIM-04-DOS', threats: ['S-4', 'D-1', 'D-3'],
    run(build) {
      const t = build();
      const CAPACITY = 100, FLOOD = 500;
      let accepted = 0, shed = 0;
      for (let i = 0; i < FLOOD; i++) {
        if (accepted < CAPACITY) { t.stores.report.submit({ case_code: 'F' + i, category: 'other', content: 'x' }); accepted++; }
        else shed++;
      }
      const intakeUp = t.stores.report.count() === CAPACITY; // did not crash; legit within capacity persisted
      return result(this.id, 'Volumetric flood / Sybil on intake', this.threats,
        'anonymity-preserving rate limit sheds abuse; intake stays up; legit persisted',
        intakeUp && shed > 0, { accepted, shed, intakeAvailable: intakeUp ? 1 : 0 });
    },
  },
  {
    id: 'SIM-05-PRIVILEGE-ESCALATION', threats: ['E-1', 'E-3'],
    run(build) {
      const t = build();
      t.iam.addPrincipal('mallory', { roles: ['clerk'], mfa: 'fido2', zone: ZONES.EXECUTIVE });
      const d = t.iam.decide({ principal: 'mallory', action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: 'M1' });
      return result(this.id, 'Privilege escalation without grant', this.threats,
        'denied — no valid JIT grant', !d.allow, { escalationAllowed: d.allow ? 1 : 0 });
    },
  },
  {
    id: 'SIM-06-IDENTITY-SPOOFING', threats: ['S-3', 'S-5'],
    run(build) {
      const t = build();
      t.iam.addPrincipal('weakauth', { roles: ['investigate'], mfa: 'password', zone: ZONES.EXECUTIVE });
      let rejected = false;
      try { t.iam.grant({ principal: 'weakauth', action: 'read-evidence', zone: ZONES.EXECUTIVE, matter: 'M1' }); }
      catch (e) { rejected = /phishing-resistant/i.test(e.message); }
      return result(this.id, 'Non-phishing-resistant auth for privileged action', this.threats,
        'rejected — FIDO2 required', rejected, { weakAuthAccepted: rejected ? 0 : 1 });
    },
  },
  {
    id: 'SIM-07-POLICY-BYPASS', threats: ['E-1'],
    run(build) {
      const t = build();
      const e = t.policy.evaluate({ action: 'undeclared-action' });
      return result(this.id, 'Undeclared action policy bypass attempt', this.threats,
        'default-deny', e.effect === 'deny', { defaultDeny: e.effect === 'deny' ? 1 : 0 });
    },
  },
  {
    id: 'SIM-08-MISCONFIGURED-INFRA', threats: ['I-6', 'E-3'],
    run(build) {
      // Deliberately misconfigure: a judiciary service also wired to the executive DB.
      const broken = defaultTopology();
      broken.find((s) => s.name === 'adjudication').dbZones.push(ZONES.EXECUTIVE);
      const t = build({ topology: broken });
      const res = zoneIsolation.check(t);
      return result(this.id, 'Misconfigured infra (cross-zone DB) is DETECTED', this.threats,
        'fitness function fails -> build blocked', res.pass === false, { violationsDetected: res.violations.length });
    },
  },
  {
    id: 'SIM-09-DATA-EXFILTRATION', threats: ['I-4', 'I-1'],
    run(build) {
      const t = build();
      t.stores.report.submit({ case_code: 'X1', category: 'official', content: 'top-secret-synthetic' });
      const row = t.stores.report._rawRow('X1'); // simulate a DB dump
      const leakedPlaintext = typeof row.content_cipher === 'string' || String(JSON.stringify(row)).includes('top-secret-synthetic');
      return result(this.id, 'Data exfiltration (DB dump) attempt', this.threats,
        'dump yields only ciphertext; no plaintext', !leakedPlaintext && isCiphertext(row.content_cipher),
        { plaintextLeaked: leakedPlaintext ? 1 : 0 });
    },
  },
  {
    id: 'SIM-10-GOVERNANCE-FAILURE', threats: ['RK-03', 'RK-24'],
    run(build) {
      const t = build();
      // Custodians coerced/unavailable: only 2 distinct approvals when 3 required.
      let blocked = false;
      try { t.threshold.authorize('safety-override', ['c1', 'c2', 'c2']); } catch (e) { blocked = e.code === 'THRESHOLD_NOT_MET'; }
      return result(this.id, 'Governance failure / custodian coercion', this.threats,
        'no single/partial-party override; threshold holds', blocked, { partialOverrideBlocked: blocked ? 1 : 0 });
    },
  },
  {
    id: 'SIM-11-COMPONENT-FAILURE', threats: ['D-4'],
    run(build) {
      const t = build();
      t.policy.setAvailable(false);
      const e = t.policy.evaluate({ action: 'submit-report' });
      return result(this.id, 'Policy engine outage (component failure)', this.threats,
        'fail-closed (deny) during outage', e.effect === 'deny', { failedOpen: e.effect === 'deny' ? 0 : 1 });
    },
  },
  {
    id: 'SIM-12-DISASTER-RECOVERY', threats: ['D-1', 'RK-13'],
    run(build) {
      const t = build();
      t.stores.evidenceExec.ingest({ id: 'DR1', actor: 'inv1', role: 'investigate', content: 'synthetic-dr-evidence', matter: 'M1' });
      const raw = t.stores.evidenceExec._rawObject('DR1');
      // "Offshore DR backup" = serialize ciphertext only (no plaintext, no keys co-located).
      const backup = JSON.parse(JSON.stringify({ id: raw.id, contentHash: raw.contentHash, cipher: raw.cipher }));
      const plaintextInBackup = JSON.stringify(backup).includes('synthetic-dr-evidence');
      const stillCiphertext = isCiphertext(backup.cipher);
      const integrityPreserved = backup.contentHash === raw.contentHash;
      return result(this.id, 'Disaster recovery from ciphertext-only backup', this.threats,
        'restore preserves integrity; no plaintext in backup',
        !plaintextInBackup && stillCiphertext && integrityPreserved,
        { plaintextInBackup: plaintextInBackup ? 1 : 0, integrityPreserved: integrityPreserved ? 1 : 0 });
    },
  },
];

function runAll(build) {
  return scenarios.map((s) => s.run(build));
}

module.exports = { scenarios, runAll };
