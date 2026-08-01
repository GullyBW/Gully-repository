'use strict';
// Institutional Governance Ownership (Stabilization Part 14). Technical architecture must
// reflect ORGANISATIONAL accountability: for every bounded context, who is responsible, who
// approves, who operates it, who stewards its data, which board governs it, and how an issue
// escalates. Deterministic data + validation; it records accountability, it never exercises it.
//
// Separation of duties is enforced structurally: the RESPONSIBLE authority may never also be
// the APPROVING authority, and every escalation path must terminate at a recognised board.
const contextMap = require('../architecture/context-map');

// Recognised governance boards (the escalation terminals).
const BOARDS = {
  ARB: { name: 'Architecture Review Board', mandate: 'Architecture changes, ADR conformance; veto on invariant breach.' },
  ISRB: { name: 'Information Security Review Board', mandate: '🔒 Security-critical subsystems; cryptography and key custody sign-off.' },
  OB: { name: 'Oversight Board', mandate: 'Constitutional invariants, governance decisions; super-majority for zone/identity changes.' },
  DGB: { name: 'Data Governance Board', mandate: 'Classification, purpose limitation, retention, exchange approval.' },
  ORB: { name: 'Operations Review Board', mandate: 'Availability, capacity, change and incident management.' },
  SDB: { name: 'Service Delivery Board', mandate: 'Citizen-facing service quality, portfolio and lifecycle decisions.' },
};

// One accountability record per bounded context (keys mirror the context map exactly).
const OWNERSHIP = {
  'identity-access': { responsibleAuthority: 'National Identity Authority', approvingAuthority: 'Information Security Review Board', operationalOwner: 'Platform Security Operations', dataSteward: 'Identity Data Steward', governanceBoard: 'ISRB', escalation: ['Platform Security Operations', 'National Identity Authority', 'ISRB'] },
  'policy-governance': { responsibleAuthority: 'Office of the Chief Information Security Officer', approvingAuthority: 'Information Security Review Board', operationalOwner: 'Policy Engineering Team', dataSteward: 'Policy Steward', governanceBoard: 'ISRB', escalation: ['Policy Engineering Team', 'Office of the Chief Information Security Officer', 'ISRB'] },
  'persistence': { responsibleAuthority: 'Government Data Centre Authority', approvingAuthority: 'Architecture Review Board', operationalOwner: 'Platform Engineering', dataSteward: 'Records Steward', governanceBoard: 'ARB', escalation: ['Platform Engineering', 'Government Data Centre Authority', 'ARB'] },
  'crypto-agility': { responsibleAuthority: 'National Cryptographic Authority', approvingAuthority: 'Information Security Review Board', operationalOwner: 'Key Custody Team', dataSteward: 'Key Custody Steward', governanceBoard: 'ISRB', escalation: ['Key Custody Team', 'National Cryptographic Authority', 'ISRB'] },
  'platform-events': { responsibleAuthority: 'Office of the Chief Technology Officer', approvingAuthority: 'Architecture Review Board', operationalOwner: 'Platform Engineering', dataSteward: 'Event Contract Steward', governanceBoard: 'ARB', escalation: ['Platform Engineering', 'Office of the Chief Technology Officer', 'ARB'] },
  'privacy': { responsibleAuthority: 'Data Protection Commissioner', approvingAuthority: 'Oversight Board', operationalOwner: 'Privacy Engineering Team', dataSteward: 'Privacy Officer', governanceBoard: 'OB', escalation: ['Privacy Engineering Team', 'Data Protection Commissioner', 'OB'] },
  'intake': { responsibleAuthority: 'Independent Complaints Directorate', approvingAuthority: 'Oversight Board', operationalOwner: 'Intake Service Team', dataSteward: 'Reporting Data Steward', governanceBoard: 'OB', escalation: ['Intake Service Team', 'Independent Complaints Directorate', 'OB'] },
  'custody': { responsibleAuthority: 'Directorate of Forensic Services', approvingAuthority: 'Oversight Board', operationalOwner: 'Evidence Custody Team', dataSteward: 'Evidence Steward', governanceBoard: 'OB', escalation: ['Evidence Custody Team', 'Directorate of Forensic Services', 'OB'] },
  'investigation': { responsibleAuthority: 'Directorate on Corruption and Economic Crime', approvingAuthority: 'Oversight Board', operationalOwner: 'Investigation Service Team', dataSteward: 'Case Data Steward', governanceBoard: 'OB', escalation: ['Investigation Service Team', 'Directorate on Corruption and Economic Crime', 'OB'] },
  'orchestration': { responsibleAuthority: 'Office of the Chief Technology Officer', approvingAuthority: 'Architecture Review Board', operationalOwner: 'Workflow Engineering Team', dataSteward: 'Process Steward', governanceBoard: 'ARB', escalation: ['Workflow Engineering Team', 'Office of the Chief Technology Officer', 'ARB'] },
  'data-fabric': { responsibleAuthority: 'National Data Office', approvingAuthority: 'Data Governance Board', operationalOwner: 'Data Platform Team', dataSteward: 'Canonical Model Steward', governanceBoard: 'DGB', escalation: ['Data Platform Team', 'National Data Office', 'DGB'] },
  'data-exchange': { responsibleAuthority: 'National Data Office', approvingAuthority: 'Data Governance Board', operationalOwner: 'Data Exchange Team', dataSteward: 'Exchange Data Steward', governanceBoard: 'DGB', escalation: ['Data Exchange Team', 'National Data Office', 'DGB'] },
  'analytics': { responsibleAuthority: 'Office of Statistics and Analysis', approvingAuthority: 'Data Governance Board', operationalOwner: 'Analytics Team', dataSteward: 'Analytics Steward', governanceBoard: 'DGB', escalation: ['Analytics Team', 'Office of Statistics and Analysis', 'DGB'] },
  'ai-advisory': { responsibleAuthority: 'Office of Statistics and Analysis', approvingAuthority: 'AI Governance Board', operationalOwner: 'Decision Support Team', dataSteward: 'Model Steward', governanceBoard: 'OB', escalation: ['Decision Support Team', 'Office of Statistics and Analysis', 'OB'] },
  'security': { responsibleAuthority: 'National Computer Incident Response Team', approvingAuthority: 'Information Security Review Board', operationalOwner: 'Security Operations Centre', dataSteward: 'Threat Intelligence Steward', governanceBoard: 'ISRB', escalation: ['Security Operations Centre', 'National Computer Incident Response Team', 'ISRB'] },
  'tenancy-federation': { responsibleAuthority: 'Ministry of Public Administration', approvingAuthority: 'Architecture Review Board', operationalOwner: 'Federation Team', dataSteward: 'Tenant Steward', governanceBoard: 'ARB', escalation: ['Federation Team', 'Ministry of Public Administration', 'ARB'] },
  'infrastructure': { responsibleAuthority: 'Government Data Centre Authority', approvingAuthority: 'Operations Review Board', operationalOwner: 'Infrastructure Operations', dataSteward: 'Configuration Steward', governanceBoard: 'ORB', escalation: ['Infrastructure Operations', 'Government Data Centre Authority', 'ORB'] },
  'supply-chain': { responsibleAuthority: 'Public Procurement Authority', approvingAuthority: 'Information Security Review Board', operationalOwner: 'Supply Chain Assurance Team', dataSteward: 'Supplier Records Steward', governanceBoard: 'ISRB', escalation: ['Supply Chain Assurance Team', 'Public Procurement Authority', 'ISRB'] },
  'observability': { responsibleAuthority: 'Office of the Chief Technology Officer', approvingAuthority: 'Operations Review Board', operationalOwner: 'Site Reliability Engineering', dataSteward: 'Telemetry Steward', governanceBoard: 'ORB', escalation: ['Site Reliability Engineering', 'Office of the Chief Technology Officer', 'ORB'] },
  'resilience': { responsibleAuthority: 'National Disaster Management Office', approvingAuthority: 'Operations Review Board', operationalOwner: 'Resilience Engineering Team', dataSteward: 'Continuity Steward', governanceBoard: 'ORB', escalation: ['Resilience Engineering Team', 'National Disaster Management Office', 'ORB'] },
  'assurance': { responsibleAuthority: 'Office of the Chief Architect', approvingAuthority: 'Architecture Review Board', operationalOwner: 'Assurance Engineering Team', dataSteward: 'Evidence Steward', governanceBoard: 'ARB', escalation: ['Assurance Engineering Team', 'Office of the Chief Architect', 'ARB'] },
  'legislation': { responsibleAuthority: 'Attorney General Chambers', approvingAuthority: 'Oversight Board', operationalOwner: 'Legal Informatics Team', dataSteward: 'Legislative Steward', governanceBoard: 'OB', escalation: ['Legal Informatics Team', 'Attorney General Chambers', 'OB'] },
  'api-governance': { responsibleAuthority: 'Office of the Chief Technology Officer', approvingAuthority: 'Architecture Review Board', operationalOwner: 'API Platform Team', dataSteward: 'Contract Steward', governanceBoard: 'ARB', escalation: ['API Platform Team', 'Office of the Chief Technology Officer', 'ARB'] },
  'developer-platform': { responsibleAuthority: 'Office of the Chief Technology Officer', approvingAuthority: 'Architecture Review Board', operationalOwner: 'Developer Experience Team', dataSteward: 'SDK Steward', governanceBoard: 'ARB', escalation: ['Developer Experience Team', 'Office of the Chief Technology Officer', 'ARB'] },
  'knowledge': { responsibleAuthority: 'National Archives and Records Services', approvingAuthority: 'Oversight Board', operationalOwner: 'Knowledge Management Team', dataSteward: 'Records Steward', governanceBoard: 'OB', escalation: ['Knowledge Management Team', 'National Archives and Records Services', 'OB'] },
  'portfolio': { responsibleAuthority: 'Ministry of Public Administration', approvingAuthority: 'Service Delivery Board', operationalOwner: 'Service Portfolio Team', dataSteward: 'Service Records Steward', governanceBoard: 'SDB', escalation: ['Service Portfolio Team', 'Ministry of Public Administration', 'SDB'] },
  'governance-oversight': { responsibleAuthority: 'Oversight Board Secretariat', approvingAuthority: 'Oversight Board', operationalOwner: 'Governance Operations Team', dataSteward: 'Decision Ledger Steward', governanceBoard: 'OB', escalation: ['Governance Operations Team', 'Oversight Board Secretariat', 'OB'] },
  'intelligence': { responsibleAuthority: 'Office of the Chief Architect', approvingAuthority: 'Oversight Board', operationalOwner: 'Systems Intelligence Team', dataSteward: 'Correlation Steward', governanceBoard: 'OB', escalation: ['Systems Intelligence Team', 'Office of the Chief Architect', 'OB'] },
  'geo': { responsibleAuthority: 'Department of Surveys and Mapping', approvingAuthority: 'Data Governance Board', operationalOwner: 'Geospatial Team', dataSteward: 'Geospatial Steward', governanceBoard: 'DGB', escalation: ['Geospatial Team', 'Department of Surveys and Mapping', 'DGB'] },
  'composition': { responsibleAuthority: 'Office of the Chief Architect', approvingAuthority: 'Architecture Review Board', operationalOwner: 'Platform Engineering', dataSteward: 'Configuration Steward', governanceBoard: 'ARB', escalation: ['Platform Engineering', 'Office of the Chief Architect', 'ARB'] },
};

const ROLES = ['responsibleAuthority', 'approvingAuthority', 'operationalOwner', 'dataSteward', 'governanceBoard'];

function subsystems() { return Object.keys(OWNERSHIP); }
function describe(id) {
  const o = OWNERSHIP[id];
  if (!o) throw new Error('no ownership record for subsystem: ' + id);
  const board = BOARDS[o.governanceBoard];
  return { subsystem: id, ...o, escalation: [...o.escalation], board: { id: o.governanceBoard, ...board } };
}
function boards() { return Object.entries(BOARDS).map(([id, b]) => ({ id, ...b, subsystems: subsystems().filter((s) => OWNERSHIP[s].governanceBoard === id) })); }

// The escalation path for a subsystem, ending at its governance board.
function escalationPath(id) { const o = describe(id); return { subsystem: id, path: o.escalation, terminatesAt: o.escalation[o.escalation.length - 1], board: o.board.name }; }

// Who is accountable for a given bounded context, resolved through the context map.
function accountabilityFor(contextId) {
  const ctx = contextMap.describe(contextId);
  return { context: contextId, purpose: ctx.purpose, ...describe(contextId) };
}

// Every bounded context must have a complete, separation-of-duties-respecting record.
function validate() {
  const violations = [];
  const mapped = new Set(contextMap.ids());
  for (const id of subsystems()) {
    const o = OWNERSHIP[id];
    for (const role of ROLES) if (!o[role]) violations.push(`${id}: missing ${role}`);
    if (o.responsibleAuthority === o.approvingAuthority) violations.push(`${id}: responsible and approving authority are the same (separation of duties)`);
    if (!Array.isArray(o.escalation) || o.escalation.length < 2) violations.push(`${id}: escalation path is not defined`);
    else if (!BOARDS[o.escalation[o.escalation.length - 1]] && o.escalation[o.escalation.length - 1] !== BOARDS[o.governanceBoard]?.name) {
      // The terminal entry must be the governance board (by id or by name).
      if (o.escalation[o.escalation.length - 1] !== o.governanceBoard) violations.push(`${id}: escalation does not terminate at a governance board`);
    }
    if (!BOARDS[o.governanceBoard]) violations.push(`${id}: unknown governance board '${o.governanceBoard}'`);
    if (!mapped.has(id)) violations.push(`${id}: ownership recorded for a subsystem that is not in the context map`);
  }
  for (const ctx of contextMap.ids()) if (!OWNERSHIP[ctx]) violations.push(`bounded context '${ctx}' has no institutional owner`);
  return { valid: violations.length === 0, violations, subsystems: subsystems().length, boards: Object.keys(BOARDS).length };
}

// The full ownership model as served to the API and rendered into docs/governance-ownership.md.
function model() {
  return {
    subsystems: subsystems().map(describe),
    boards: boards(),
    validation: validate(),
    note: 'Records institutional accountability. Approval and escalation are performed by named humans; this module never approves anything.',
  };
}

module.exports = { OWNERSHIP, BOARDS, ROLES, subsystems, describe, boards, escalationPath, accountabilityFor, validate, model };
