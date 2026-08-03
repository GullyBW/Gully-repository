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

// --- Owner activity, training and escalation workflow (Phase 12, Part 13) ------------------------
//
// Phase 11 asked "is somebody available to decide?" That is necessary and not sufficient. An owner
// who has recorded no governance act in eight months is nominally available and practically absent;
// an owner whose mandatory training lapsed two years ago is available, active, and not currently
// competent to exercise the role. Both states look identical in an availability register, and both
// are how a governance object stops being governed while the org chart still says otherwise.
//
// AVAILABILITY is what somebody declared. ACTIVITY is what they did. They are different facts and
// the platform records them separately.
const ACTIVITY_BANDS = [
  { band: 'active', maxDaysSinceAct: 90, meaning: 'has exercised the role within the current review cycle' },
  { band: 'stale', maxDaysSinceAct: 180, meaning: 'has not acted in over a quarter — verify the role is still held' },
  { band: 'dormant', maxDaysSinceAct: Infinity, meaning: 'has not acted in over six months — treat the role as vacant until confirmed' },
];
const GOVERNANCE_ACTS = ['decision', 'approval', 'review', 'escalation-response', 'attestation'];

class ActivityRegister {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._acts = []; }
  recordAct({ person, act, subsystem = null, at = null, reference = null } = {}) {
    if (!person) throw new Error('a governance act must name the person or office that performed it');
    if (!GOVERNANCE_ACTS.includes(act)) throw new Error(`unknown governance act '${act}' — one of ${GOVERNANCE_ACTS.join(', ')}`);
    const t = at ?? this._clock();
    if (!Number.isFinite(t)) throw new Error('a governance act must be timestamped');
    const rec = { id: `ACT-${String(this._acts.length + 1).padStart(4, '0')}`, person, act, subsystem, at: t, reference };
    this._acts.push(rec);
    return { ...rec };
  }
  acts(person = null) { return this._acts.filter((a) => !person || a.person === person).map((a) => ({ ...a })); }
  lastAct(person) {
    const mine = this._acts.filter((a) => a.person === person);
    return mine.length ? mine.reduce((m, a) => (a.at > m.at ? a : m)) : null;
  }
  // NEVER ACTED is its own state, and it is the worst one — not an absence of evidence that gets
  // rounded up to "probably fine". An office nobody has ever seen act is an office on paper.
  status(person, { now = null } = {}) {
    const t = now ?? this._clock();
    const last = this.lastAct(person);
    if (!last) return { person, band: 'never-acted', daysSinceAct: null, lastAct: null, acceptable: false, reason: 'no governance act has ever been recorded for this office' };
    const days = Math.floor((t - last.at) / (24 * 3600_000));
    const band = ACTIVITY_BANDS.find((b) => days <= b.maxDaysSinceAct);
    return { person, band: band.band, daysSinceAct: days, lastAct: { act: last.act, at: last.at, subsystem: last.subsystem }, acceptable: band.band === 'active', reason: band.meaning };
  }
}

// Training. A role carries obligations somebody has to have been taught; an expired certification is
// not a formality, it is the reason a decision can be challenged afterwards.
const REQUIRED_TRAINING = {
  responsibleAuthority: ['records-management', 'evidence-handling'],
  approvingAuthority: ['records-management', 'separation-of-duties'],
  operationalOwner: ['incident-response', 'records-management'],
  dataSteward: ['data-protection', 'records-management'],
};
const TRAINING_VALIDITY_DAYS = 365;

class TrainingRegister {
  constructor({ clock = () => 0, validityDays = TRAINING_VALIDITY_DAYS } = {}) { this._clock = clock; this._validity = validityDays; this._records = new Map(); }
  recordCompletion({ person, course, at = null, by } = {}) {
    if (!person || !course) throw new Error('a training record needs a person and a course');
    if (!by) throw new Error('a training completion must be attested by a named human — a self-declared certification certifies nothing');
    const t = at ?? this._clock();
    if (!Number.isFinite(t)) throw new Error('a training completion must be timestamped');
    const key = `${person}:${course}`;
    const prior = this._records.get(key);
    // Keep the most recent completion; re-taking a course renews it, it does not duplicate it.
    if (!prior || t > prior.at) this._records.set(key, { person, course, at, attestedBy: by, expiresAt: t + this._validity * 24 * 3600_000 });
    return { ...this._records.get(key) };
  }
  completions(person = null) { return [...this._records.values()].filter((r) => !person || r.person === person).map((r) => ({ ...r })); }
  // Status for one (person, role) pair. Missing and expired are reported SEPARATELY, because the
  // remedy differs: one is "book the course", the other is "you have been operating uncertified".
  status(person, role, { now = null } = {}) {
    const t = now ?? this._clock();
    const required = REQUIRED_TRAINING[role] || [];
    const rows = required.map((course) => {
      const rec = this._records.get(`${person}:${course}`);
      if (!rec) return { course, held: false, state: 'never-completed', expiresAt: null };
      return { course, held: t < rec.expiresAt, state: t < rec.expiresAt ? 'current' : 'expired', completedAt: rec.at, expiresAt: rec.expiresAt, attestedBy: rec.attestedBy };
    });
    const missing = rows.filter((r) => r.state === 'never-completed').map((r) => r.course);
    const expired = rows.filter((r) => r.state === 'expired').map((r) => r.course);
    return {
      person, role, required, courses: rows, missing, expired,
      current: missing.length === 0 && expired.length === 0,
      reason: missing.length ? `never completed: ${missing.join(', ')}` : expired.length ? `expired: ${expired.join(', ')}` : 'all required training is current',
    };
  }
}

// Escalation as a WORKFLOW, not a diagram. Phase 11 published the escalation path; a path nobody
// walks is a picture. An escalation that is raised and never acknowledged is the actual failure
// mode, and it is invisible unless the raising is stateful.
const ESCALATION_STATES = ['raised', 'acknowledged', 'resolved'];
const ACKNOWLEDGEMENT_HOURS = 24;

class EscalationWorkflow {
  constructor({ clock = () => 0, acknowledgementHours = ACKNOWLEDGEMENT_HOURS } = {}) {
    this._clock = clock; this._ackWindow = acknowledgementHours * 3600_000; this._items = new Map(); this._seq = 0;
  }
  raise({ subsystem, reason, raisedBy, at = null } = {}) {
    if (!OWNERSHIP[subsystem]) throw new Error('no ownership record for subsystem: ' + subsystem);
    if (!reason || !raisedBy) throw new Error('an escalation must state a reason and name who raised it');
    const t = at ?? this._clock();
    const path = escalationPath(subsystem);
    const id = `ESC-${String(++this._seq).padStart(4, '0')}`;
    const item = { id, subsystem, reason, raisedBy, raisedAt: t, state: 'raised', path: path.path, terminatesAt: path.terminatesAt, ackDueAt: t + this._ackWindow, acknowledgedBy: null, acknowledgedAt: null, resolvedBy: null, resolvedAt: null, resolution: null };
    this._items.set(id, item);
    return { ...item };
  }
  acknowledge(id, { by, at = null } = {}) {
    const it = this._items.get(id); if (!it) throw new Error('unknown escalation: ' + id);
    if (!by) throw new Error('an acknowledgement must name the human who made it');
    if (it.state !== 'raised') throw new Error(`escalation ${id} is '${it.state}' and cannot be acknowledged again`);
    it.state = 'acknowledged'; it.acknowledgedBy = by; it.acknowledgedAt = at ?? this._clock();
    return { ...it };
  }
  resolve(id, { by, resolution, at = null } = {}) {
    const it = this._items.get(id); if (!it) throw new Error('unknown escalation: ' + id);
    if (!by || !resolution) throw new Error('a resolution must name a human and state what was decided');
    // An escalation cannot skip acknowledgement: "resolved without anyone admitting they saw it" is
    // precisely the record that makes an after-the-fact review impossible.
    if (it.state !== 'acknowledged') throw new Error(`escalation ${id} is '${it.state}' — it must be acknowledged before it can be resolved`);
    it.state = 'resolved'; it.resolvedBy = by; it.resolvedAt = at ?? this._clock(); it.resolution = resolution;
    return { ...it };
  }
  items({ state = null } = {}) { return [...this._items.values()].filter((i) => !state || i.state === state).map((i) => ({ ...i })); }
  overdue({ now = null } = {}) {
    const t = now ?? this._clock();
    return this.items({ state: 'raised' }).filter((i) => t > i.ackDueAt).map((i) => ({ ...i, overdueByMs: t - i.ackDueAt }));
  }
  status({ now = null } = {}) {
    const t = now ?? this._clock();
    const all = this.items();
    const overdue = this.overdue({ now: t });
    return {
      states: ESCALATION_STATES, acknowledgementHours: this._ackWindow / 3600_000,
      total: all.length,
      byState: all.reduce((acc, i) => ((acc[i.state] = (acc[i.state] || 0) + 1), acc), {}),
      open: all.filter((i) => i.state !== 'resolved').map((i) => i.id),
      unacknowledged: overdue.map((i) => ({ id: i.id, subsystem: i.subsystem, overdueByMs: i.overdueByMs, escalateTo: i.terminatesAt })),
      healthy: overdue.length === 0,
      note: 'An escalation raised and never acknowledged is the failure this workflow exists to make visible. Resolution cannot skip acknowledgement.',
    };
  }
}

// ACTIVE coverage: is there somebody available, ACTIVE and TRAINED to decide for every governance
// object? This is the Part 13 invariant — no governance object without active ownership — and it is
// deliberately separate from `coverageScore()`, which answers the narrower availability question.
//
// Activity and training default to UNKNOWN when no register is supplied, and unknown is reported as
// unknown rather than as satisfied. A platform that treats "we have no record of this owner acting"
// as evidence of active ownership has inverted the meaning of the word evidence.
function activeCoverage({ availability = null, activity = null, training = null, now = 0 } = {}) {
  const avail = availability || new AvailabilityRegister({ clock: () => now });
  const rows = [];
  for (const id of subsystems()) {
    for (const role of DEPUTY_ROLES) {
      const eff = avail.effectiveOwner(id, role, now);
      const holder = eff.holder;
      const act = holder && activity ? activity.status(holder, { now }) : null;
      const trn = holder && training ? training.status(holder, role, { now }) : null;
      const blockers = [];
      if (!eff.covered) blockers.push(`nobody available — ${eff.reason}`);
      if (holder && !activity) blockers.push('no activity register supplied — whether this owner is active is unknown, and unknown is not active');
      else if (act && !act.acceptable) blockers.push(`${holder} is ${act.band}: ${act.reason}`);
      if (holder && !training) blockers.push('no training register supplied — whether this owner is currently certified is unknown');
      else if (trn && !trn.current) blockers.push(`${holder} training ${trn.reason}`);
      rows.push({
        subsystem: id, role, holder, via: eff.via,
        available: eff.covered,
        activity: act, training: trn,
        activelyOwned: blockers.length === 0, blockers,
        escalateTo: blockers.length ? BOARDS[OWNERSHIP[id].governanceBoard].name : null,
      });
    }
  }
  const owned = rows.filter((r) => r.activelyOwned);
  return {
    pairs: rows, total: rows.length, activelyOwned: owned.length,
    coverage: rows.length ? +(owned.length / rows.length).toFixed(4) : 0,
    unowned: rows.filter((r) => !r.activelyOwned).map((r) => ({ subsystem: r.subsystem, role: r.role, blockers: r.blockers, escalateTo: r.escalateTo })),
    complete: owned.length === rows.length,
    failClosed: true, authorizes: false,
    note: 'No governance object without ACTIVE ownership. Available, active and trained are three separate facts; satisfying one does not imply the others.',
  };
}

// The continuity dashboard a governance board reads: availability, activity, training, escalation
// and review, in one place, aggregated to the weakest of them.
function continuityDashboard({ availability = null, activity = null, training = null, escalations = null, now = 0, lastReviewed = {} } = {}) {
  const active = activeCoverage({ availability, activity, training, now });
  const gaps = ownershipGaps({ availability, now, lastReviewed });
  const review = reviewSchedule({ now, lastReviewed });
  const esc = escalations ? escalations.status({ now }) : { healthy: null, total: 0, unacknowledged: [], note: 'no escalation workflow supplied — unacknowledged escalations cannot be reported, which is not the same as there being none' };
  const dormant = activity ? [...new Set(active.pairs.filter((p) => p.activity && !p.activity.acceptable).map((p) => p.holder))].sort() : null;
  const uncertified = training ? [...new Set(active.pairs.filter((p) => p.training && !p.training.current).map((p) => p.holder))].sort() : null;
  const blockers = [
    ...active.unowned.map((u) => `${u.subsystem}/${u.role}: ${u.blockers.join('; ')}`),
    ...gaps.gaps.filter((g) => g.kind === 'structural').map((g) => `${g.subsystem}/${g.role}: ${g.detail}`),
    ...(esc.unacknowledged || []).map((u) => `${u.id}: escalation unacknowledged past its window, escalate to ${u.escalateTo}`),
  ];
  return {
    question: 'Is every governance object owned by somebody who is available, active and currently certified?',
    answer: blockers.length === 0
      ? 'Yes, for every subsystem and role assessed.'
      : 'No. Each blocker below is a governance object that is nominally owned and practically not.',
    activeCoverage: active.coverage,
    availabilityCoverage: coverageScore({ availability, now }).coverage,
    dormantOwners: dormant, uncertifiedOwners: uncertified,
    escalations: esc,
    reviewOverdue: review.filter((r) => r.overdue).map((r) => r.subsystem),
    structuralGaps: gaps.gaps.filter((g) => g.kind === 'structural'),
    blockers, sound: blockers.length === 0,
    activityBands: ACTIVITY_BANDS.map((b) => ({ ...b, maxDaysSinceAct: b.maxDaysSinceAct === Infinity ? null : b.maxDaysSinceAct })),
    requiredTraining: JSON.parse(JSON.stringify(REQUIRED_TRAINING)),
    informationalOnly: true, authorizes: false,
    note: 'Availability is what somebody declared; activity is what they did; training is what they are certified to do. The dashboard aggregates to the weakest of the three, because a role fails on whichever is missing.',
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
  ACTIVITY_BANDS, GOVERNANCE_ACTS, REQUIRED_TRAINING, TRAINING_VALIDITY_DAYS, ESCALATION_STATES,
  ActivityRegister, TrainingRegister, EscalationWorkflow, activeCoverage, continuityDashboard,
};
