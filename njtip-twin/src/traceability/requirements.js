'use strict';
// Requirements catalogue. Each requirement links business/legal/constitutional/
// governance/security/privacy intent to the automated verifiers that continuously
// enforce it (fitness functions, adversarial simulations, formal checks). This is
// the source of truth for the traceability engine.
//
// types: business | legal | constitutional | governance | security | privacy | operational
module.exports = [
  {
    id: 'REQ-ANON-001', type: 'constitutional', priority: 'critical',
    statement: 'No reporter-identifying data is ever collected or stored (technical inability to de-anonymize).',
    refs: { decision: ['D-02'], ddr: ['DDR-05', 'DDR-10'], threats: ['ID-1', 'I-1'], risks: ['RK-01'] },
    verifiers: { fitness: ['FIT-IDENTITY-MINIMIZATION', 'FIT-ENCRYPTION'], sims: ['SIM-01-COMPROMISED-OPERATOR', 'SIM-09-DATA-EXFILTRATION'], formal: ['FORMAL-ACCESS-CONTROL'] },
  },
  {
    id: 'REQ-ZONE-001', type: 'constitutional', priority: 'critical',
    statement: 'Separation of powers: three non-collapsible data zones; no cross-zone raw reads.',
    refs: { decision: ['D-06'], ddr: ['DDR-01', 'DDR-04', 'DDR-07'], threats: ['I-6', 'E-3'], risks: ['RK-09'] },
    verifiers: { fitness: ['FIT-ZONE-ISOLATION', 'FIT-SECURE-DATA-FLOWS'], sims: ['SIM-02-INSIDER-CROSS-ZONE', 'SIM-08-MISCONFIGURED-INFRA'], formal: [] },
  },
  {
    id: 'REQ-OPERATOR-001', type: 'governance', priority: 'critical',
    statement: 'The operator is in the threat model: no single party can de-anonymize (M-of-N threshold).',
    refs: { decision: ['D-01'], ddr: ['DDR-10', 'DDR-13'], threats: ['E-1', 'I-1'], risks: ['RK-01', 'RK-06'] },
    verifiers: { fitness: ['FIT-GOVERNANCE'], sims: ['SIM-01-COMPROMISED-OPERATOR', 'SIM-10-GOVERNANCE-FAILURE'], formal: ['FORMAL-APPROVAL-CHAIN'] },
  },
  {
    id: 'REQ-LEASTPRIV-001', type: 'security', priority: 'critical',
    statement: 'Least privilege: zero standing privilege, separation of duties, phishing-resistant auth.',
    refs: { decision: ['D-01'], ddr: ['DDR-09'], threats: ['E-1', 'E-3', 'S-3'], risks: ['RK-06'] },
    verifiers: { fitness: ['FIT-LEAST-PRIVILEGE'], sims: ['SIM-05-PRIVILEGE-ESCALATION', 'SIM-06-IDENTITY-SPOOFING'], formal: ['FORMAL-ACCESS-CONTROL'] },
  },
  {
    id: 'REQ-ZEROTRUST-001', type: 'security', priority: 'critical',
    statement: 'Zero Trust: authenticate every request; fail-closed on control outage.',
    refs: { decision: ['D-01'], ddr: ['DDR-09'], threats: ['S-3', 'E-1'], risks: ['RK-06'] },
    verifiers: { fitness: ['FIT-ZERO-TRUST', 'FIT-POLICY-ENFORCEMENT'], sims: ['SIM-07-POLICY-BYPASS', 'SIM-11-COMPONENT-FAILURE'], formal: ['FORMAL-POLICY-LOGIC'] },
  },
  {
    id: 'REQ-AUDIT-001', type: 'governance', priority: 'high',
    statement: 'Tamper-evident, append-only, externally-anchored audit of all actions.',
    refs: { decision: ['D-01'], ddr: ['DDR-13'], threats: ['T-2', 'R-2', 'R-3'], risks: ['RK-06'] },
    verifiers: { fitness: ['FIT-AUDITABILITY'], sims: ['SIM-15-UNAUTHORIZED-DATA-MODIFICATION'], formal: [] },
  },
  {
    id: 'REQ-CUSTODY-001', type: 'legal', priority: 'high',
    statement: 'Digital chain of custody: evidence integrity re-verified on access; tamper detected.',
    refs: { decision: ['D-10'], ddr: ['DDR-06'], threats: ['T-1', 'T-5'], risks: ['RK-08'] },
    verifiers: { fitness: ['FIT-CHAIN-OF-CUSTODY'], sims: ['SIM-16-EVIDENCE-TAMPERING'], formal: [] },
  },
  {
    id: 'REQ-EMERGENCY-001', type: 'governance', priority: 'high',
    statement: 'Emergency/break-glass access is dual-controlled, time-boxed, reason-coded, and audited.',
    refs: { decision: ['D-01'], ddr: ['DDR-09'], threats: ['E-1', 'E-3'], risks: ['RK-06', 'RK-24'] },
    verifiers: { fitness: ['FIT-EMERGENCY'], sims: ['SIM-14-EMERGENCY-PRIVILEGE-ABUSE'], formal: [] },
  },
  {
    id: 'REQ-BACKUP-001', type: 'operational', priority: 'high',
    statement: 'Backups are ciphertext-only, integrity-checked, and never co-located with keys.',
    refs: { decision: ['D-03'], ddr: ['DDR-02'], threats: ['I-4', 'D-1'], risks: ['RK-13'] },
    verifiers: { fitness: ['FIT-BACKUP'], sims: ['SIM-30-BACKUP-CORRUPTION', 'SIM-12-DISASTER-RECOVERY'], formal: [] },
  },
  {
    id: 'REQ-TIME-001', type: 'operational', priority: 'medium',
    statement: 'Trusted time source with skew detection; certificate validity enforced.',
    refs: { decision: ['D-03'], ddr: ['DDR-06'], threats: ['T-5'], risks: ['RK-13'] },
    verifiers: { fitness: ['FIT-TIME-INTEGRITY'], sims: ['SIM-31-TIME-SYNC-FAILURE', 'SIM-22-CERTIFICATE-COMPROMISE'], formal: [] },
  },
  {
    id: 'REQ-COVERAGE-001', type: 'governance', priority: 'high',
    statement: 'Every requirement is continuously verifiable (traceability coverage is 100%).',
    refs: { decision: ['D-11'], ddr: [], threats: [], risks: [] },
    verifiers: { fitness: ['FIT-TRACEABILITY-COVERAGE'], sims: [], formal: [] },
  },
];
