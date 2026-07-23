'use strict';
// The APPROVED architecture-of-record. Drift detection compares the actual running
// twin + registries against this. Changing the twin's architecture without updating
// this manifest (through governance) is reported as drift.
module.exports = {
  version: '0.2.0',
  zones: ['independent', 'executive', 'judiciary'],
  services: [
    { name: 'reporting', zone: 'independent' }, { name: 'governance', zone: 'independent' }, { name: 'audit', zone: 'independent' },
    { name: 'investigation', zone: 'executive' }, { name: 'prosecution', zone: 'executive' },
    { name: 'adjudication', zone: 'judiciary' }, { name: 'court-admin', zone: 'judiciary' },
  ],
  policyDefault: 'deny',
  expectedFitness: [
    'FIT-ZONE-ISOLATION', 'FIT-IDENTITY-MINIMIZATION', 'FIT-LEAST-PRIVILEGE', 'FIT-POLICY-ENFORCEMENT',
    'FIT-ZERO-TRUST', 'FIT-SECURE-DATA-FLOWS', 'FIT-ENCRYPTION', 'FIT-AUDITABILITY', 'FIT-GOVERNANCE',
    'FIT-CHAIN-OF-CUSTODY', 'FIT-EMERGENCY', 'FIT-BACKUP', 'FIT-TIME-INTEGRITY', 'FIT-TRACEABILITY-COVERAGE',
  ],
  crossZoneFlows: [
    'executive->judiciary', 'judiciary->executive', 'independent->executive', 'independent->judiciary',
  ],
};
