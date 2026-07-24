'use strict';
// Compliance Automation (Phase 25). Continuously maps the platform's fitness controls to
// external standards and generates COMPLIANCE EVIDENCE. Deterministic. Compliance evidence
// SUPPORTS an assessment; it NEVER authorizes deployment without explicit human approval.
//
// The mapping is illustrative and reviewable; a control is "met" only if ALL its supporting
// fitness checks pass. Gaps are surfaced honestly.

// standard → clause → [supporting fitness ids]
const STANDARDS = {
  'ISO/IEC 27001': {
    'A.5 Policies': ['APP-FIT-POLICY-AS-DATA'],
    'A.8 Asset/crypto': ['FIT-ENCRYPTION', 'APP-FIT-CIPHERTEXT-ONLY'],
    'A.9 Access control': ['FIT-ZERO-TRUST', 'APP-FIT-AUTHZ-DEFAULT-DENY', 'APP-FIT-CREDENTIAL-HYGIENE'],
    'A.12 Operations': ['INFRA-FIT-K8S-HARDENING', 'INFRA-FIT-CONFIG-VALIDATION'],
    'A.13 Comms security': ['FIT-SECURE-DATA-FLOWS', 'APP-FIT-PII-FREE-EVENTS', 'INFRA-FIT-NETWORK-DEFAULT-DENY'],
    'A.16 Incident mgmt': ['FIT-EMERGENCY'],
    'A.17 Continuity': ['FIT-BACKUP', 'INFRA-FIT-DR-BACKUP-RESTORE'],
    'A.18 Compliance/audit': ['FIT-AUDITABILITY', 'APP-FIT-EVENT-SOURCING'],
  },
  'ISO 22301': {
    'BC continuity': ['FIT-BACKUP', 'INFRA-FIT-DR-BACKUP-RESTORE', 'INFRA-FIT-HA-SCALABILITY'],
    'Incident response': ['FIT-EMERGENCY'],
  },
  'NIST CSF': {
    Identify: ['INFRA-FIT-DRIFT', 'FIT-TRACEABILITY-COVERAGE'],
    Protect: ['FIT-ZERO-TRUST', 'APP-FIT-CIPHERTEXT-ONLY', 'APP-FIT-TENANT-ISOLATION'],
    Detect: ['APP-FIT-EVENT-SOURCING', 'FIT-AUDITABILITY'],
    Respond: ['FIT-EMERGENCY', 'APP-FIT-POLICY-AS-DATA'],
    Recover: ['FIT-BACKUP', 'INFRA-FIT-DR-BACKUP-RESTORE'],
  },
  'CIS Controls': {
    'Access control mgmt': ['APP-FIT-AUTHZ-DEFAULT-DENY', 'APP-FIT-POLICY-AS-DATA'],
    'Data protection': ['FIT-IDENTITY-MINIMIZATION', 'APP-FIT-ANALYTICS-PRIVACY'],
    'Audit log mgmt': ['FIT-AUDITABILITY', 'APP-FIT-EVENT-SOURCING'],
  },
  'OWASP ASVS': {
    'V1 Architecture': ['FIT-ZONE-ISOLATION', 'FIT-SECURE-DATA-FLOWS'],
    'V4 Access control': ['APP-FIT-AUTHZ-DEFAULT-DENY', 'APP-FIT-POLICY-AS-DATA'],
    'V7 Logging': ['FIT-AUDITABILITY', 'APP-FIT-TRACE-PRIVACY'],
    'V8 Data protection': ['FIT-IDENTITY-MINIMIZATION', 'APP-FIT-CIPHERTEXT-ONLY'],
  },
  'National privacy law': {
    'Data minimisation': ['FIT-IDENTITY-MINIMIZATION'],
    'Purpose limitation': ['APP-FIT-ANALYTICS-PRIVACY', 'APP-FIT-GRAPH-PRIVACY'],
    Anonymity: ['APP-FIT-ANONYMITY-BOUNDARY'],
  },
};

// Assess coverage against all standards from a set of fitness results ({id, pass}).
function assess(fitnessResults) {
  const passing = new Set(fitnessResults.filter((r) => r.pass).map((r) => r.id));
  const known = new Set(fitnessResults.map((r) => r.id));
  const standards = {};
  for (const [std, clauses] of Object.entries(STANDARDS)) {
    const rows = {};
    let met = 0; const total = Object.keys(clauses).length;
    for (const [clause, ids] of Object.entries(clauses)) {
      const present = ids.filter((id) => known.has(id));
      const ok = present.length > 0 && present.every((id) => passing.has(id));
      if (ok) met++;
      rows[clause] = { controls: ids, met: ok, missing: ids.filter((id) => !passing.has(id)) };
    }
    standards[std] = { coverage: total ? +(met / total).toFixed(2) : 0, met, total, clauses: rows };
  }
  return {
    standards,
    overallCoverage: +avg(Object.values(standards).map((s) => s.coverage)).toFixed(2),
    humanGate: { required: true, note: 'Compliance evidence supports an assessment; it NEVER authorizes deployment without explicit human approval.' },
  };
}
function avg(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; }

module.exports = { STANDARDS, assess };
