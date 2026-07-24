'use strict';
// Government Capability Model (Phase 38). Documents the platform as BUSINESS CAPABILITIES:
// a capability map with domain/service ownership, dependencies, governance mapping, and a
// heat map driven by the LIVE fitness gate. Deterministic. This model drives future evolution.

// The capability map (data): capability → { domain, services, dependsOn, controls (fitness ids) }.
const CAPABILITY_MAP = {
  'Anonymous Reporting': { domain: 'Intake', services: ['workflow', 'events'], dependsOn: [], controls: ['FIT-IDENTITY-MINIMIZATION', 'APP-FIT-ANONYMITY-BOUNDARY'] },
  'Case Management': { domain: 'Investigation', services: ['workflow', 'orchestration'], dependsOn: ['Anonymous Reporting'], controls: ['APP-FIT-LIFECYCLE-DEFAULT-DENY', 'APP-FIT-WORKFLOW-INTEGRITY'] },
  'Evidence & Custody': { domain: 'Investigation', services: ['custody', 'objectStore'], dependsOn: ['Case Management'], controls: ['APP-FIT-CIPHERTEXT-ONLY', 'APP-FIT-CUSTODY-SIGNED-CHAIN', 'FIT-CHAIN-OF-CUSTODY'] },
  'Identity & Access': { domain: 'Security', services: ['iam', 'session', 'oidc'], dependsOn: [], controls: ['APP-FIT-AUTHZ-DEFAULT-DENY', 'APP-FIT-POLICY-AS-DATA', 'APP-FIT-CREDENTIAL-HYGIENE'] },
  'Event Governance': { domain: 'Platform', services: ['events', 'eventRegistry', 'eventBus'], dependsOn: [], controls: ['APP-FIT-EVENT-SOURCING', 'APP-FIT-EVENT-GOVERNANCE', 'APP-FIT-EVENTBUS-FEDERATION'] },
  'Analytics & Intelligence': { domain: 'Insight', services: ['analytics', 'graph', 'ai'], dependsOn: ['Case Management'], controls: ['APP-FIT-ANALYTICS-PRIVACY', 'APP-FIT-SEMANTIC-GRAPH-ADVISORY', 'APP-FIT-AI-ADVISORY-ONLY'] },
  'Multi-Agency Federation': { domain: 'Collaboration', services: ['tenants', 'federation'], dependsOn: ['Identity & Access'], controls: ['APP-FIT-TENANT-ISOLATION'] },
  'Privacy Engineering': { domain: 'Security', services: ['privacy'], dependsOn: [], controls: ['APP-FIT-PRIVACY-ENGINEERING', 'FIT-IDENTITY-MINIMIZATION'] },
  'Assurance & Governance': { domain: 'Governance', services: ['compliance', 'twin2', 'workflowSim'], dependsOn: [], controls: ['FIT-GOVERNANCE', 'FIT-AUDITABILITY', 'APP-FIT-WORKFLOW-SIMULATION'] },
  'Operations & Resilience': { domain: 'Operations', services: ['tracer', 'evaluateSlo', 'twin3'], dependsOn: [], controls: ['INFRA-FIT-HA-SCALABILITY', 'INFRA-FIT-DR-BACKUP-RESTORE'] },
};

function capabilityMap() { return CAPABILITY_MAP; }
function dependencies() { const m = {}; for (const [c, d] of Object.entries(CAPABILITY_MAP)) m[c] = d.dependsOn; return m; }
function ownership() { const m = {}; for (const [c, d] of Object.entries(CAPABILITY_MAP)) (m[d.domain] = m[d.domain] || []).push(c); return m; }

// Heat map: per-capability health from the live fitness results ({id, pass}).
function heatMap(fitnessResults) {
  const pass = new Set(fitnessResults.filter((r) => r.pass).map((r) => r.id));
  const known = new Set(fitnessResults.map((r) => r.id));
  const out = {};
  for (const [cap, d] of Object.entries(CAPABILITY_MAP)) {
    const present = d.controls.filter((id) => known.has(id));
    const green = present.filter((id) => pass.has(id)).length;
    out[cap] = { domain: d.domain, controls: present.length, green, health: present.length ? +(green / present.length).toFixed(2) : null, status: present.length && green === present.length ? 'healthy' : green > 0 ? 'degraded' : 'unknown' };
  }
  return out;
}

module.exports = { CAPABILITY_MAP, capabilityMap, dependencies, ownership, heatMap };
