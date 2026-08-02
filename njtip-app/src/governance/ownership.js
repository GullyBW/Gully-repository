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
  // Phase 11, Part 13: continuity is part of ownership. A structural gap in the deputy model is
  // an ownership defect, not a continuity footnote.
  for (const g of ownershipGaps().gaps.filter((x) => x.kind === 'structural')) {
    violations.push(`${g.subsystem}/${g.role}: ${g.detail}`);
  }
  return { valid: violations.length === 0, violations, subsystems: subsystems().length, boards: Object.keys(BOARDS).length };
}

// --- Governance continuity (Phase 11, Part 13) ---------------------------------------------------
//
// An owner who is on leave is an owner who cannot decide, and a governance object with nobody
// available to decide is a governance object that has quietly stopped being governed. Continuity
// makes that visible: every accountable role has a named DEPUTY, availability is recorded, and a
// role with neither an available primary nor an available deputy is an OWNERSHIP GAP, not a
// footnote.
//
// Deputies are DERIVED by a stated rule rather than hand-listed, so a new context cannot be added
// without one. The rule is the ordinary government structure: every office has a deputy.
const DEPUTY_RULE = 'Deputy <primary office>, unless an override records a different named deputy.';
const DEPUTY_ROLES = ['responsibleAuthority', 'approvingAuthority', 'operationalOwner', 'dataSteward'];
// Overrides where the deputy is genuinely a different institution rather than a deputy of the same
// one — a board's deputy is its vice-chair, not a "Deputy Board".
const DEPUTY_OVERRIDES = {
  'Architecture Review Board': 'ARB Vice-Chair',
  'Information Security Review Board': 'ISRB Vice-Chair',
  'Oversight Board': 'Oversight Board Vice-Chair',
  'Data Governance Board': 'DGB Vice-Chair',
  'Operations Review Board': 'ORB Vice-Chair',
  'Service Delivery Board': 'SDB Vice-Chair',
  'AI Governance Board': 'AI Governance Board Vice-Chair',
};
function deputyOf(primary) { return DEPUTY_OVERRIDES[primary] || `Deputy ${primary}`; }
function deputies(subsystem) {
  const o = OWNERSHIP[subsystem];
  if (!o) throw new Error('no ownership record for subsystem: ' + subsystem);
  return Object.fromEntries(DEPUTY_ROLES.map((r) => [r, deputyOf(o[r])]));
}

// Review cadence per board. A governance record nobody revisits is a record that describes the
// organisation as it was, which is the state most ownership documents are in.
const REVIEW_CADENCE_DAYS = { ISRB: 90, OB: 90, ARB: 180, DGB: 180, ORB: 180, SDB: 365 };

// Availability register: who is unavailable, from when, until when, and who recorded it.
// Unavailability is time-bounded on purpose — an open-ended absence is an unfilled post.
class AvailabilityRegister {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._absences = []; }
  recordAbsence({ person, from, until, reason, by }) {
    if (!person) throw new Error('an absence must name a person or office');
    if (!by || !reason) throw new Error('an absence must be recorded by a named human, with a reason');
    if (!(Number.isFinite(from) && Number.isFinite(until))) throw new Error('an absence must be time-bounded — an open-ended absence is an unfilled post');
    if (!(until > from)) throw new Error('an absence must end after it starts');
    const rec = { id: `ABS-${String(this._absences.length + 1).padStart(4, '0')}`, person, from, until, reason, by, at: this._clock() };
    this._absences.push(rec);
    return { ...rec };
  }
  absences() { return this._absences.map((a) => ({ ...a })); }
  isAvailable(person, at = null) {
    const t = at ?? this._clock();
    return !this._absences.some((a) => a.person === person && t >= a.from && t < a.until);
  }
  // Who actually decides right now: the primary if available, otherwise the deputy, otherwise
  // nobody — and "nobody" escalates rather than defaulting to whoever is around.
  effectiveOwner(subsystem, role, at = null) {
    const o = OWNERSHIP[subsystem];
    if (!o) throw new Error('no ownership record for subsystem: ' + subsystem);
    if (!DEPUTY_ROLES.includes(role)) throw new Error(`role '${role}' has no continuity chain`);
    const t = at ?? this._clock();
    const primary = o[role];
    const deputy = deputyOf(primary);
    if (this.isAvailable(primary, t)) return { subsystem, role, holder: primary, via: 'primary', covered: true };
    if (this.isAvailable(deputy, t)) return { subsystem, role, holder: deputy, via: 'deputy', covered: true };
    return {
      subsystem, role, holder: null, via: 'none', covered: false,
      escalateTo: BOARDS[o.governanceBoard].name,
      reason: `neither ${primary} nor ${deputy} is available — this decision escalates to ${BOARDS[o.governanceBoard].name}`,
    };
  }
}

// Succession: the ordered chain of who decides when the person above is unavailable. It always
// terminates at a board, because a chain that ends in a person can end in nobody.
function successionPlan(subsystem, role = 'approvingAuthority') {
  const o = OWNERSHIP[subsystem];
  if (!o) throw new Error('no ownership record for subsystem: ' + subsystem);
  if (!DEPUTY_ROLES.includes(role)) throw new Error(`role '${role}' has no succession chain`);
  const primary = o[role];
  const boardName = BOARDS[o.governanceBoard].name;
  // Where the accountable office IS the board, the chain is chair → vice-chair → the board sitting
  // as a body. That is not a duplicate: a chair acting alone and a quorate board are different
  // authorities, and only the second can act when the first two cannot.
  const chain = [
    { order: 1, holder: primary, basis: primary === boardName ? 'board chair, acting under delegated authority' : 'primary accountable office' },
    { order: 2, holder: deputyOf(primary), basis: 'named deputy' },
    { order: 3, holder: boardName, basis: primary === boardName ? 'the board sitting as a body — quorum required' : 'governance board — the terminal authority' },
  ];
  return {
    subsystem, role, chain, terminatesAtBoard: true,
    depth: chain.length,
    note: 'A succession chain that ends in a person can end in nobody. This one ends at a board.',
  };
}

// Review schedule per subsystem, from its board's cadence and the last recorded review.
function reviewSchedule({ now = 0, lastReviewed = {} } = {}) {
  return subsystems().map((id) => {
    const board = OWNERSHIP[id].governanceBoard;
    const cadence = REVIEW_CADENCE_DAYS[board] ?? 365;
    const last = lastReviewed[id] ?? null;
    const dueAt = last === null ? null : last + cadence * 24 * 3600_000;
    return {
      subsystem: id, board, cadenceDays: cadence, lastReviewed: last, dueAt,
      // Never reviewed is OVERDUE, not pending. A record nobody has ever checked is the least
      // trustworthy kind, so it cannot sit in a softer bucket than one reviewed too long ago.
      overdue: last === null || now > dueAt,
      daysUntilDue: dueAt === null ? null : Math.floor((dueAt - now) / (24 * 3600_000)),
      reason: last === null ? 'never reviewed' : now > dueAt ? 'review is overdue' : 'within cadence',
    };
  });
}

// Coverage: the fraction of (subsystem, role) pairs with somebody actually available to decide.
function coverageScore({ availability = null, now = 0 } = {}) {
  const reg = availability || new AvailabilityRegister({ clock: () => now });
  const pairs = [];
  for (const id of subsystems()) for (const role of DEPUTY_ROLES) pairs.push(reg.effectiveOwner(id, role, now));
  const covered = pairs.filter((p) => p.covered);
  const byVia = pairs.reduce((acc, p) => ((acc[p.via] = (acc[p.via] || 0) + 1), acc), {});
  return {
    pairs: pairs.length, covered: covered.length,
    coverage: pairs.length ? +(covered.length / pairs.length).toFixed(4) : 0,
    onPrimary: byVia.primary || 0, onDeputy: byVia.deputy || 0, uncovered: byVia.none || 0,
    complete: covered.length === pairs.length,
  };
}

// Ownership gaps: every place where nobody is available to decide, plus every structural defect
// in the continuity model itself.
function ownershipGaps({ availability = null, now = 0, lastReviewed = {} } = {}) {
  const reg = availability || new AvailabilityRegister({ clock: () => now });
  const gaps = [];
  for (const id of subsystems()) {
    const o = OWNERSHIP[id];
    const dep = deputies(id);
    for (const role of DEPUTY_ROLES) {
      // Structural: a deputy identical to the primary is not a deputy.
      if (dep[role] === o[role]) gaps.push({ subsystem: id, role, kind: 'structural', detail: 'the deputy is the primary' });
      // Structural: separation of duties must survive substitution — the deputy responsible
      // authority may not be the approving authority or its deputy, or an absence quietly
      // collapses the separation the primary structure exists to keep.
      if (role === 'responsibleAuthority') {
        if (dep.responsibleAuthority === o.approvingAuthority || dep.responsibleAuthority === dep.approvingAuthority) {
          gaps.push({ subsystem: id, role, kind: 'structural', detail: 'substitution collapses separation of duties' });
        }
      }
      const eff = reg.effectiveOwner(id, role, now);
      if (!eff.covered) gaps.push({ subsystem: id, role, kind: 'availability', detail: eff.reason, escalateTo: eff.escalateTo });
    }
  }
  for (const r of reviewSchedule({ now, lastReviewed })) {
    if (r.overdue) gaps.push({ subsystem: r.subsystem, role: 'governanceBoard', kind: 'review', detail: r.reason });
  }
  return {
    gaps, count: gaps.length,
    byKind: gaps.reduce((acc, g) => ((acc[g.kind] = (acc[g.kind] || 0) + 1), acc), {}),
    clean: gaps.length === 0,
    note: 'A governance object with nobody available to decide is not governed, whatever the record says.',
  };
}

function continuityReport({ availability = null, now = 0, lastReviewed = {} } = {}) {
  const reg = availability || new AvailabilityRegister({ clock: () => now });
  return {
    deputyRule: DEPUTY_RULE,
    deputies: subsystems().map((id) => ({ subsystem: id, ...deputies(id) })),
    succession: subsystems().map((id) => successionPlan(id)),
    availability: reg.absences(),
    effectiveOwners: subsystems().map((id) => ({ subsystem: id, roles: Object.fromEntries(DEPUTY_ROLES.map((r) => [r, reg.effectiveOwner(id, r, now)])) })),
    reviewSchedule: reviewSchedule({ now, lastReviewed }),
    coverage: coverageScore({ availability: reg, now }),
    gaps: ownershipGaps({ availability: reg, now, lastReviewed }),
    escalation: subsystems().map(escalationPath),
    informationalOnly: true, authorizes: false,
    note: 'Continuity records who can decide, not what they decide. Every accountable role has a deputy, and every chain terminates at a board.',
  };
}

// The full ownership model as served to the API and rendered into docs/governance-ownership.md.
function model() {
  return {
    subsystems: subsystems().map((id) => ({ ...describe(id), deputies: deputies(id) })),
    boards: boards(),
    continuity: continuityReport(),
    validation: validate(),
    note: 'Records institutional accountability. Approval and escalation are performed by named humans; this module never approves anything.',
  };
}

module.exports = {
  OWNERSHIP, BOARDS, ROLES, DEPUTY_ROLES, DEPUTY_RULE, DEPUTY_OVERRIDES, REVIEW_CADENCE_DAYS,
  subsystems, describe, boards, escalationPath, accountabilityFor, validate, model,
  deputyOf, deputies, AvailabilityRegister, successionPlan, reviewSchedule,
  coverageScore, ownershipGaps, continuityReport,
};
