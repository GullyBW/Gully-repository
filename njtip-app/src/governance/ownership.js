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

// --- Training assurance & knowledge continuity (Phase 13, Parts 8 & 11) --------------------------
//
// Phase 12 asked whether an owner was available, active and certified. That is enough to say a role
// is filled. It is not enough to say the institution could survive losing the person filling it,
// which is a different and harder question:
//
//   IS THERE SOMEBODY ELSE WHO COULD ACTUALLY DO THIS?
//
// The trap here is that this platform DERIVES a deputy for every role by rule, so a naive check
// finds two names everywhere and reports perfect continuity. A derived deputy who has never acted
// and holds no current training is a name, not an alternative. So deputy readiness is assessed on
// the same evidence as the primary's, and a role whose only alternative is nominal is reported as
// depending on one person.

// Rehearsals somebody has taken part in. Distinct from training: training says you were taught,
// participation says you have done it under conditions resembling the real thing.
const EXERCISE_KINDS = {
  'disaster-recovery': { relevantTo: ['operationalOwner', 'responsibleAuthority'], why: 'Restoring service is not something to attempt for the first time during an outage.' },
  'incident-escalation': { relevantTo: ['responsibleAuthority', 'approvingAuthority'], why: 'Knowing who to wake, and being willing to, is learned by doing it.' },
  'evidence-custody': { relevantTo: ['dataSteward', 'responsibleAuthority'], why: 'A custody error is unrecoverable; the rehearsal is the only safe place to make one.' },
  'emergency-authorization': { relevantTo: ['approvingAuthority'], why: 'Break-glass authority is exercised rarely and under pressure.' },
  // Added at Phase 18.1 close-out, because the audit could not ask the question. Every governance
  // capability rested on a single accountable body, `successionPlan()` returned a three-deep chain
  // for each, and no exercise kind existed that would rehearse one — so "has ARB succession ever
  // been tested" was not merely unanswered, it was unaskable. A gap nothing can express is a gap
  // nothing reports.
  'governance-succession': { relevantTo: ['approvingAuthority', 'responsibleAuthority'], why: 'A succession chain that has never been walked is a design, not a capability. The first time authority transfers should not be the first time anyone has tried.' },
};
const EXERCISE_VALIDITY_DAYS = 365;
// How recently somebody must have acted for their experience to count as current.
const EXPERIENCE_WINDOW_DAYS = 180;

class ExerciseRegister {
  constructor({ clock = () => 0, validityDays = EXERCISE_VALIDITY_DAYS } = {}) { this._clock = clock; this._validity = validityDays; this._records = []; }
  recordParticipation({ person, exercise, at = null, role = null, by, outcome = 'completed' } = {}) {
    if (!person || !exercise) throw new Error('participation needs a person and an exercise');
    if (!EXERCISE_KINDS[exercise]) throw new Error(`unknown exercise '${exercise}' — one of ${Object.keys(EXERCISE_KINDS).join(', ')}`);
    if (!by) { const e = new Error('participation must be attested by a named human — self-reported attendance attests nothing'); e.failClosed = true; throw e; }
    const t = at ?? this._clock();
    if (!Number.isFinite(t)) throw new Error('participation must be timestamped');
    const rec = { person, exercise, role, at: t, by, outcome, expiresAt: t + this._validity * 24 * 3600_000 };
    this._records.push(rec);
    return { ...rec };
  }
  participation(person = null) { return this._records.filter((r) => !person || r.person === person).map((r) => ({ ...r })); }
  // Which exercises relevant to a role this person currently holds. Lapsed participation is
  // reported separately from never having taken part: the remedies differ.
  status(person, role, { now = null } = {}) {
    const t = now ?? this._clock();
    const required = Object.entries(EXERCISE_KINDS).filter(([, k]) => k.relevantTo.includes(role)).map(([id]) => id);
    const rows = required.map((exercise) => {
      const mine = this._records.filter((r) => r.person === person && r.exercise === exercise && r.outcome === 'completed');
      const latest = mine.length ? mine.reduce((m, r) => (r.at > m.at ? r : m)) : null;
      return {
        exercise, participated: !!latest, current: !!latest && t < latest.expiresAt,
        lastAt: latest ? latest.at : null, expiresAt: latest ? latest.expiresAt : null,
        state: !latest ? 'never-participated' : t < latest.expiresAt ? 'current' : 'lapsed',
      };
    });
    return {
      person, role, required, exercises: rows,
      never: rows.filter((r) => r.state === 'never-participated').map((r) => r.exercise),
      lapsed: rows.filter((r) => r.state === 'lapsed').map((r) => r.exercise),
      current: rows.every((r) => r.state === 'current'),
      reason: rows.length === 0 ? 'no rehearsal is relevant to this role'
        : rows.every((r) => r.state === 'current') ? 'all relevant rehearsals are current'
          : `never participated: ${rows.filter((r) => r.state === 'never-participated').map((r) => r.exercise).join(', ') || 'none'}; lapsed: ${rows.filter((r) => r.state === 'lapsed').map((r) => r.exercise).join(', ') || 'none'}`,
    };
  }
}

// Whether one person could actually discharge one role today. Four independent facts, aggregated to
// the weakest — a person who is available, active and trained but has never rehearsed is not ready
// for the thing rehearsals exist to prepare for.
function roleReadiness(person, role, { availability = null, activity = null, training = null, exercises = null, now = 0 } = {}) {
  const checks = [];
  const avail = availability ? availability.isAvailable(person, now) : null;
  checks.push({ factor: 'availability', held: avail, why: avail === null ? 'no availability register supplied' : avail ? 'available' : 'recorded as absent' });
  const act = activity ? activity.status(person, { now }) : null;
  checks.push({ factor: 'activity', held: act ? act.acceptable : null, why: act ? act.reason : 'no activity register supplied' });
  const trn = training ? training.status(person, role, { now }) : null;
  checks.push({ factor: 'training', held: trn ? trn.current : null, why: trn ? trn.reason : 'no training register supplied' });
  const exr = exercises ? exercises.status(person, role, { now }) : null;
  checks.push({ factor: 'rehearsal', held: exr ? exr.current : null, why: exr ? exr.reason : 'no exercise register supplied' });

  const unknown = checks.filter((c) => c.held === null);
  const failed = checks.filter((c) => c.held === false);
  return {
    person, role, checks,
    ready: failed.length === 0 && unknown.length === 0,
    // Unknown and failed are different states with different remedies, and neither is ready.
    unknownFactors: unknown.map((c) => c.factor), failedFactors: failed.map((c) => c.factor),
    reason: failed.length ? `not ready: ${failed.map((c) => `${c.factor} (${c.why})`).join('; ')}`
      : unknown.length ? `readiness unknown: no evidence for ${unknown.map((c) => c.factor).join(', ')}`
        : 'available, active, trained and rehearsed',
  };
}

// THE PART 8 SCORECARD. Per (subsystem, role): is the primary ready, is the deputy ready, and how
// many people could actually do this? A bus factor of one is the finding.
function knowledgeContinuity({ availability = null, activity = null, training = null, exercises = null, now = 0 } = {}) {
  const rows = [];
  for (const id of subsystems()) {
    const o = OWNERSHIP[id];
    for (const role of DEPUTY_ROLES) {
      const primary = o[role];
      const deputy = deputyOf(primary);
      const p = roleReadiness(primary, role, { availability, activity, training, exercises, now });
      const d = roleReadiness(deputy, role, { availability, activity, training, exercises, now });
      const qualified = [p.ready ? primary : null, d.ready ? deputy : null].filter(Boolean);
      rows.push({
        subsystem: id, role, primary, deputy,
        primaryReadiness: p, deputyReadiness: d,
        qualified, busFactor: qualified.length,
        // The rule Part 8 states, checked rather than assumed.
        singlePersonDependency: qualified.length <= 1,
        reason: qualified.length === 0 ? 'nobody is currently ready to discharge this role'
          : qualified.length === 1 ? `only ${qualified[0]} is ready — a derived deputy who has never acted and holds no current training is a name, not an alternative`
            : 'primary and deputy are both ready',
      });
    }
  }
  const single = rows.filter((r) => r.singlePersonDependency);
  return {
    roles: rows, count: rows.length,
    singlePersonDependencies: single.map((r) => `${r.subsystem}/${r.role}`),
    unstaffed: rows.filter((r) => r.busFactor === 0).map((r) => `${r.subsystem}/${r.role}`),
    // Weakest link: the estate is as continuous as its least covered role.
    minimumBusFactor: rows.length ? Math.min(...rows.map((r) => r.busFactor)) : null,
    sound: single.length === 0,
    informationalOnly: true, authorizes: false,
    note: 'Deputy readiness is assessed on the same evidence as the primary\'s. This platform derives a deputy for every role, so counting names would report perfect continuity everywhere; only a deputy who is available, active, trained and rehearsed counts as an alternative.',
  };
}

// THE PART 11 REPORT. Training and rehearsal status across the estate, and what it costs readiness.
function trainingAssurance({ activity = null, training = null, exercises = null, now = 0 } = {}) {
  const people = new Map();
  for (const id of subsystems()) {
    for (const role of DEPUTY_ROLES) {
      for (const person of [OWNERSHIP[id][role], deputyOf(OWNERSHIP[id][role])]) {
        const key = `${person}|${role}`;
        if (!people.has(key)) people.set(key, { person, role, subsystems: [] });
        people.get(key).subsystems.push(id);
      }
    }
  }
  const rows = [...people.values()].map((p) => {
    const trn = training ? training.status(p.person, p.role, { now }) : null;
    const exr = exercises ? exercises.status(p.person, p.role, { now }) : null;
    return {
      ...p,
      training: trn ? { current: trn.current, missing: trn.missing, expired: trn.expired } : null,
      rehearsal: exr ? { current: exr.current, never: exr.never, lapsed: exr.lapsed } : null,
      certified: !!(trn && trn.current), rehearsed: !!(exr && exr.current),
      // Unknown is not certified. A register nobody supplied does not certify anybody.
      unknown: !trn || !exr,
    };
  }).sort((a, b) => a.person.localeCompare(b.person) || a.role.localeCompare(b.role));

  const certified = rows.filter((r) => r.certified);
  const expired = rows.filter((r) => r.training && r.training.expired.length);
  const neverTrained = rows.filter((r) => r.training && r.training.missing.length);
  const lapsedRehearsal = rows.filter((r) => r.rehearsal && r.rehearsal.lapsed.length);
  return {
    people: rows, count: rows.length,
    certified: certified.length,
    certificationRate: rows.length ? +(certified.length / rows.length).toFixed(4) : null,
    expiredQualifications: expired.map((r) => `${r.person} (${r.role})`),
    neverTrained: neverTrained.map((r) => `${r.person} (${r.role})`),
    lapsedRehearsals: lapsedRehearsal.map((r) => `${r.person} (${r.role})`),
    unknown: rows.filter((r) => r.unknown).map((r) => `${r.person} (${r.role})`),
    exerciseKinds: Object.entries(EXERCISE_KINDS).map(([id, k]) => ({ exercise: id, ...k })),
    requiredTraining: JSON.parse(JSON.stringify(REQUIRED_TRAINING)),
    // Part 11: expired qualifications reduce governance readiness automatically. This is the number
    // the readiness model consumes, and it falls when a certification lapses without anyone acting.
    readinessContribution: rows.length ? +(certified.length / rows.length).toFixed(4) : 0,
    sound: rows.length > 0 && expired.length === 0 && neverTrained.length === 0 && rows.every((r) => !r.unknown),
    informationalOnly: true, authorizes: false,
    note: 'An expired qualification lowers the readiness contribution on its own, with nobody deciding to lower it. Unknown is counted as not certified: a register nobody supplied certifies nobody.',
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

// --- Organizational capability maturity (Phase 16, Part 11) ----------------------------------------
//
// Knowledge continuity answers "can the institution survive losing a person". Part 11 asks the wider
// question the platform has never put in one place: how CAPABLE is this institution, across the
// seven domains it actually has to be capable in?
//
// Every level is DERIVED from a report the platform already produces, and the rule that keeps this
// from being a self-graded scorecard:
//
//   A DOMAIN WITH NO SOURCE IS UNKNOWN, AND UNKNOWN IS NOT LEVEL ZERO. Level zero means somebody
//   looked and found nothing in place. Unknown means nobody looked, and the two need different
//   people. An institution that scores itself 0 on a domain it never assessed has invented a
//   finding; one that scores itself 3 has invented a capability.
const CAPABILITY_DOMAINS = {
  governance: { asks: 'Can the institution decide, and is every decision answerable to somebody?', derivedFrom: 'the ownership record and the RACI governance maturity level' },
  operations: { asks: 'Can it run the estate and recover it?', derivedFrom: 'the operational readiness dimensions' },
  security: { asks: 'Is the posture verified rather than asserted?', derivedFrom: 'the security readiness dimension and the threat register' },
  resilience: { asks: 'Does every critical capability have a validated alternative?', derivedFrom: 'institutional resilience' },
  compliance: { asks: 'Is every obligation reconciled against a control that holds?', derivedFrom: 'compliance intelligence' },
  legalReadiness: { asks: 'Can it say what permits each capability to operate?', derivedFrom: 'the legal authority register' },
  organizationalContinuity: { asks: 'Could every accountable post change hands without a capability stopping?', derivedFrom: 'knowledge continuity' },
};

// Five levels, weakest first. `unknown` sits outside the scale on purpose: it is not a level.
const CAPABILITY_LEVELS = {
  L0: { rank: 0, name: 'Absent', means: 'Assessed, and nothing is in place.' },
  L1: { rank: 1, name: 'Declared', means: 'Assessed, and something is written down. Nothing checks it.' },
  L2: { rank: 2, name: 'Checked', means: 'An executable control checks it on every build.' },
  L3: { rank: 3, name: 'Evidenced', means: 'Checked, and the institution has recorded evidence of it working.' },
  L4: { rank: 4, name: 'Continuously assured', means: 'Evidenced, and the evidence is refreshed on a schedule that would catch it lapsing.' },
};
const CAPABILITY_ORDER = ['L0', 'L1', 'L2', 'L3', 'L4'];

// Assess one domain from whatever source was supplied. `null` in, unknown out — never a zero.
function capabilityMaturity(sources = {}) {
  const g = (fn) => { try { const r = fn(); return r === undefined ? null : r; } catch (_) { return null; } };
  const domain = (id, level, detail) => ({
    domain: id, ...CAPABILITY_DOMAINS[id],
    level: level || 'unknown',
    ...(level ? CAPABILITY_LEVELS[level] : { rank: null, name: 'Unknown', means: 'No source was supplied. Nobody has assessed this domain, which is not the same as assessing it and finding nothing.' }),
    assessed: !!level,
    detail: detail || 'no source supplied — unknown, which is not level zero',
    derived: true,
  });

  const domains = [
    domain('governance',
      g(() => { const m = sources.governanceMaturity; if (!m || !Number.isFinite(m.level)) return null; return CAPABILITY_ORDER[Math.max(0, Math.min(4, m.level - 1))]; }),
      g(() => sources.governanceMaturity && `governance maturity level ${sources.governanceMaturity.level} of 5`)),
    domain('operations',
      g(() => { const r = sources.readiness; if (!r || !Array.isArray(r.dimensions)) return null; return r.allDimensionsReady ? 'L3' : r.dimensions.some((d) => d.ready) ? 'L2' : 'L1'; }),
      g(() => sources.readiness && `${sources.readiness.readyCount}/${sources.readiness.dimensionCount} readiness dimensions ready`)),
    domain('security',
      g(() => { const r = sources.readiness; if (!r || !Array.isArray(r.dimensions)) return null; const d = r.dimensions.find((x) => x.dimension === 'security'); if (!d) return null; return d.ready ? 'L3' : d.status === 'no-evidence' ? 'L1' : 'L2'; }),
      g(() => { const d = (sources.readiness.dimensions || []).find((x) => x.dimension === 'security'); return d && `security readiness is '${d.status}'`; })),
    domain('resilience',
      g(() => { const r = sources.resilience; if (!r) return null; return r.holds ? 'L3' : Array.isArray(r.capabilities) && r.capabilities.length ? 'L2' : 'L1'; }),
      g(() => sources.resilience && `${sources.resilience.violationCount} capability(ies) rest on a single dependency`)),
    domain('compliance',
      g(() => { const c = sources.compliance; if (!c) return null; return c.reconciliation && c.reconciliation.sound ? 'L3' : 'L2'; }),
      g(() => sources.compliance && `compliance rate ${sources.compliance.complianceRate}`)),
    domain('legalReadiness',
      g(() => { const l = sources.legalAuthority; if (!l) return null; return l.complete ? 'L3' : l.declared && l.declared.length ? 'L1' : 'L0'; }),
      g(() => sources.legalAuthority && `${sources.legalAuthority.authorized.length} of ${sources.legalAuthority.count} capabilities have a reviewed legal basis`)),
    domain('organizationalContinuity',
      g(() => { const c = sources.continuity; if (!c) return null; return c.sound ? 'L3' : Number.isFinite(c.minimumBusFactor) ? 'L2' : 'L1'; }),
      g(() => sources.continuity && `minimum bus factor ${sources.continuity.minimumBusFactor}`)),
  ];

  const assessed = domains.filter((d) => d.assessed);
  // Weakest link, as everywhere. An institution is as capable as its least capable domain, and an
  // unassessed domain does not get to be the strongest by not being looked at.
  const weakest = assessed.length
    ? assessed.slice().sort((a, b) => a.rank - b.rank || a.domain.localeCompare(b.domain))[0]
    : null;
  return {
    domains, count: domains.length,
    catalogue: Object.entries(CAPABILITY_DOMAINS).map(([domain, d]) => ({ domain, ...d })),
    levels: CAPABILITY_ORDER.map((id) => ({ level: id, ...CAPABILITY_LEVELS[id] })),
    unknown: domains.filter((d) => !d.assessed).map((d) => d.domain),
    assessedCount: assessed.length,
    // The institution's level is the weakest ASSESSED domain, and the report says how many were not
    // assessed at all rather than folding them in either direction.
    organizationalLevel: weakest ? weakest.level : 'unknown',
    weakestDomain: weakest ? weakest.domain : null,
    complete: domains.every((d) => d.assessed),
    everyLevelDerived: domains.every((d) => d.derived === true),
    basis: assessed.length
      ? `the institution is at ${weakest.level} (${weakest.name}), the level of its weakest ASSESSED domain '${weakest.domain}'. ${domains.length - assessed.length} domain(s) were not assessed at all and are UNKNOWN rather than counted at either end.`
      : 'No capability domain has a source to assess it from. The institution\'s maturity is unknown, which is not the same as absent.',
    informationalOnly: true, authorizes: false,
    note: 'Every level is derived from a report the platform already produces. A domain with no source is UNKNOWN, and unknown is not level zero: level zero means somebody looked and found nothing, unknown means nobody looked, and the two need different people.',
  };
}

// How the maturity has moved. Snapshots are supplied by the caller — this module owns no store, and
// inventing a history would invent the improvement.
function maturityEvolution(snapshots = []) {
  if (!Array.isArray(snapshots) || snapshots.length < 2) {
    return {
      snapshots: snapshots.length, direction: 'unknown', measurable: false,
      reason: 'fewer than two snapshots — a direction needs at least two, and one reading is not a trend',
      informationalOnly: true, authorizes: false,
    };
  }
  const rankOf = (level) => (CAPABILITY_LEVELS[level] ? CAPABILITY_LEVELS[level].rank : null);
  const series = snapshots.map((s) => ({ level: s.organizationalLevel, rank: rankOf(s.organizationalLevel), assessed: s.assessedCount }));
  const measured = series.filter((s) => s.rank !== null);
  if (measured.length < 2) {
    return {
      snapshots: snapshots.length, series, direction: 'unknown', measurable: false,
      reason: 'fewer than two snapshots carry an assessed level — an unknown level is not a rank of zero, so no direction can be derived',
      informationalOnly: true, authorizes: false,
    };
  }
  const delta = measured[measured.length - 1].rank - measured[0].rank;
  // Coverage moves independently of level, and a rise in coverage that lowers the level is progress
  // being reported as regression. Both are carried.
  const coverageDelta = series[series.length - 1].assessed - series[0].assessed;
  const byDomain = Object.keys(CAPABILITY_DOMAINS).map((id) => {
    const levels = snapshots.map((s) => (s.domains || []).find((d) => d.domain === id)).filter(Boolean);
    const ranks = levels.map((d) => (d.assessed ? d.rank : null)).filter((r) => r !== null);
    return {
      domain: id,
      from: levels.length ? levels[0].level : 'unknown', to: levels.length ? levels[levels.length - 1].level : 'unknown',
      direction: ranks.length < 2 ? 'unknown' : ranks[ranks.length - 1] > ranks[0] ? 'improving' : ranks[ranks.length - 1] < ranks[0] ? 'regressing' : 'steady',
    };
  });
  return {
    snapshots: snapshots.length, series, byDomain,
    delta, coverageDelta,
    direction: delta > 0 ? 'improving' : delta < 0 ? 'regressing' : 'steady',
    measurable: true,
    // Said plainly, because it is the most common way a maturity trend is misread.
    coverageNote: coverageDelta > 0 && delta < 0
      ? `The level fell while assessed coverage rose by ${coverageDelta} domain(s). Assessing a domain that was previously unknown can only lower the weakest-link level; that is the assessment working, not the institution regressing.`
      : null,
    regressing: byDomain.filter((d) => d.direction === 'regressing').map((d) => d.domain),
    improving: byDomain.filter((d) => d.direction === 'improving').map((d) => d.domain),
    reason: `organizational level moved ${measured[0].level} → ${measured[measured.length - 1].level} across ${snapshots.length} snapshot(s)`,
    informationalOnly: true, authorizes: false,
  };
}

// --- Capability evolution (Phase 17, Part 10) -------------------------------------------------------
//
// `maturityEvolution` reports the direction between the first and last snapshot. Part 10 asks what
// happened in between, and the figure that answers it is the one nothing carried before:
//
//   VELOCITY WITHOUT STABILITY IS CHURN. An institution that rises two levels and falls two has a
//   net movement of zero, a mean velocity of zero, and has been anything but steady. Reported as a
//   direction it reads "steady", which is the exact opposite of what happened to the people doing
//   the work.
//
// So total movement is carried beside net movement, and an institution whose net is small relative
// to its total is named as churning rather than progressing.
function capabilityEvolution({ snapshots = [], evidence = [], periodDays = null, now = 0 } = {}) {
  const evidenceConfidence = require('../assurance/evidence-confidence');
  const rankOf = (level) => (CAPABILITY_LEVELS[level] ? CAPABILITY_LEVELS[level].rank : null);
  const ranks = snapshots.map((s) => rankOf(s.organizationalLevel)).filter((r) => r !== null);

  if (ranks.length < 2) {
    return {
      snapshots: snapshots.length, assessedSnapshots: ranks.length, measurable: false,
      progression: null, regression: null, netMovement: null, totalMovement: null,
      improvementVelocity: null, velocityUnit: null, organizationalStability: null, churn: null,
      trend: evidenceConfidence.verifiedImprovement({ subject: 'organizational capability', series: [] }),
      everyImprovementVerified: true,
      reason: `${ranks.length} snapshot(s) carry an assessed level; at least two are needed before anything can be said to have moved. An unknown level is not a rank of zero.`,
      now, informationalOnly: true, authorizes: false,
    };
  }

  const steps = ranks.slice(1).map((r, i) => r - ranks[i]);
  const progression = steps.filter((s) => s > 0).reduce((a, b) => a + b, 0);
  const regression = Math.abs(steps.filter((s) => s < 0).reduce((a, b) => a + b, 0));
  const netMovement = ranks[ranks.length - 1] - ranks[0];
  const totalMovement = steps.reduce((a, s) => a + Math.abs(s), 0);

  // Velocity states its unit rather than implying a timescale nobody supplied. Per snapshot when no
  // period length is given; per day when one is.
  const improvementVelocity = periodDays
    ? +(netMovement / (periodDays * steps.length)).toFixed(6)
    : +(netMovement / steps.length).toFixed(4);
  const velocityUnit = periodDays
    ? `levels per day, over ${steps.length} period(s) of ${periodDays} day(s)`
    : `levels per snapshot — no period length was supplied, so this is NOT a rate over time`;

  // Mean absolute step. Lower is steadier; this is the figure velocity alone cannot show.
  const organizationalStability = +(totalMovement / steps.length).toFixed(4);
  // THE FIGURE THAT CATCHES AN INSTITUTION THAT LOOKS FLAT.
  const churn = totalMovement > 0 && Math.abs(netMovement) < totalMovement / 2;

  const trend = evidenceConfidence.verifiedImprovement({
    subject: 'organizational capability', series: ranks, evidence,
  });

  return {
    snapshots: snapshots.length, assessedSnapshots: ranks.length, measurable: true,
    ranks, steps,
    progression, regression, netMovement, totalMovement,
    improvementVelocity, velocityUnit, organizationalStability, churn,
    trend,
    everyImprovementVerified: !trend.violatesInvariant,
    reason: churn
      ? `the institution moved ${totalMovement} level-step(s) in total and ended ${netMovement} from where it started — that is churning rather than progressing, and a direction alone would report it as steady`
      : `${progression} step(s) of progression and ${regression} of regression across ${steps.length} interval(s); net ${netMovement}`,
    now, informationalOnly: true, authorizes: false,
    note: 'Velocity without stability is churn: an institution that rises two levels and falls two has a mean velocity of zero and has been anything but steady. The two figures are reported together, and a rise with nothing verified behind it is an unverified improvement rather than progress.',
  };
}

// --- The succession exercise state machine --------------------------------------------------------
//
// Two different questions were being conflated, and separating them is what this register is for.
//
//   SUCCESSION_ASSURANCE_LEVELS answers "how well assured is this SUBSYSTEM's succession" — a
//   maturity ladder from DOCUMENTED to VERIFIED, computed fresh from the records each time.
//
//   SUCCESSION_EXERCISE_STATES, below, answers "how far has THIS EXERCISE got" — an instance
//   lifecycle that a specific drill moves through, with evidence captured at each step.
//
// The ladder READS this register rather than keeping its own idea of what has been rehearsed. One
// source of truth: an exercise reaching VERIFIED here is what makes a subsystem VERIFIED there.
//
// AUTHORITY_RESTORED is the state the walk could never establish. `successionExercise()` reports the
// `authority-restored` stage as UNKNOWN because a succession chain says who acts while the primary
// is away and says nothing about how acting ends. That is still true of the CHAIN. What changes here
// is that an exercise can RECORD a restoration, with evidence, and then the stage is answerable for
// that exercise — which is the difference between a design and a rehearsal.
const SUCCESSION_EXERCISE_STATES = {
  PLANNED: {
    order: 1, establishedBy: 'machine', terminal: false,
    means: 'An exercise is declared with a scenario, a capability, a responsible authority and an intended successor. Nothing has happened yet.',
    doesNotEstablish: 'That the exercise will be run, or that it would succeed.',
    requires: ['exerciseId', 'scenario', 'capability', 'responsibleAuthority', 'intendedSuccessor', 'scope', 'prerequisites'],
  },
  REHEARSED: {
    order: 2, establishedBy: 'record of a human act', terminal: false,
    means: 'The exercise was executed and what happened was recorded, including what failed.',
    doesNotEstablish: 'That it worked. A drill can be run and fail, and the failure is evidence.',
    requires: ['participants', 'actions', 'outcome', 'failures', 'at'],
  },
  VERIFIED: {
    order: 3, establishedBy: 'human judgement', terminal: false,
    means: 'The declared verification criteria were evaluated against the rehearsal evidence, and a named human other than the runner recorded the decision.',
    doesNotEstablish: 'That the institution can do this under real conditions with different people.',
    requires: ['criteria', 'criteriaResults', 'evaluator', 'decision', 'evidenceIntegrity'],
  },
  AUTHORITY_RESTORED: {
    order: 4, establishedBy: 'human judgement', terminal: true,
    means: 'Authority returned to the primary office, the interregnum was closed, and a governance body confirmed it.',
    doesNotEstablish: 'That restoration would be as clean when the absence was not scheduled.',
    requires: ['restoredTo', 'restoredBy', 'restorationEvent', 'governanceConfirmation', 'at'],
  },
};

// Every valid transition, stated rather than implied. Anything not listed here is refused.
//
// The reset is deliberate and narrow: an exercise that has been VERIFIED may be re-planned as a NEW
// exercise, and this register refuses to move a verified record backwards. Re-running a drill means
// declaring another one, so the history of the first survives. An institution that can edit its
// rehearsal history has no rehearsal history.
const SUCCESSION_TRANSITIONS = [
  { from: null, to: 'PLANNED', why: 'An exercise is declared before it is run.' },
  { from: 'PLANNED', to: 'REHEARSED', why: 'The declared exercise was executed.' },
  { from: 'REHEARSED', to: 'VERIFIED', why: 'The rehearsal evidence was evaluated against the criteria by a named human.' },
  { from: 'VERIFIED', to: 'AUTHORITY_RESTORED', why: 'Authority returned to the primary and a governance body confirmed it.' },
];
const SUCCESSION_TRANSITION_INDEX = new Map(SUCCESSION_TRANSITIONS.map((t) => [`${t.from}->${t.to}`, t]));

// The failure conditions a drill must be able to represent. A framework that can only describe
// success is a framework that reports success.
const SUCCESSION_FAILURE_MODES = {
  'successor-unavailable': 'The named successor cannot act.',
  'nominated-successor-unavailable': 'The successor nominated for this exercise specifically cannot act.',
  'authority-transfer-rejected': 'The successor declined or was refused the authority.',
  'approver-unavailable': 'The approver required to confirm the transfer cannot act.',
  'conflicting-authorities': 'Two holders claim the same authority at once.',
  'incomplete-succession-record': 'The record of what happened is missing something required.',
  'expired-authorization': 'The authorization relied on had lapsed.',
  'invalid-credentials': 'The successor could not establish who they were.',
  'insufficient-quorum': 'The body could not reach quorum to act.',
  'corrupted-evidence': 'The exercise evidence does not match what was recorded.',
  'unavailable-supporting-service': 'A system the capability depends on was down.',
  'communication-failure': 'The people involved could not reach each other.',
  'duplicate-succession-attempt': 'The same succession was attempted twice.',
  'conflicting-succession-attempts': 'Two different successions were attempted for one authority.',
  'unauthorized-restoration-attempt': 'Authority was taken back by somebody not entitled to restore it.',
};

// A register of succession exercises. Declared, never inferred; append-only in effect, because a
// transition rewrites nothing that came before it. Fails closed on every incomplete transition.
class SuccessionExerciseRegister {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._exercises = new Map(); }

  _fail(msg) { const e = new Error(msg); e.failClosed = true; throw e; }

  // Every transition passes through here, so the state machine has exactly one gate.
  _assertTransition(from, to) {
    if (!SUCCESSION_EXERCISE_STATES[to]) this._fail(`'${to}' is not a succession exercise state`);
    if (!SUCCESSION_TRANSITION_INDEX.has(`${from}->${to}`)) {
      this._fail(`${from || 'nothing'} -> ${to} is not a valid succession transition. Valid: ${SUCCESSION_TRANSITIONS.map((t) => `${t.from || 'nothing'} -> ${t.to}`).join(', ')}`);
    }
  }

  // Every required field must be present AND non-empty. A field that exists and says nothing is how
  // a state gets marked complete without anything having happened.
  _assertEvidence(state, evidence) {
    const required = SUCCESSION_EXERCISE_STATES[state].requires;
    for (const field of required) {
      const value = evidence[field];
      const empty = value === undefined || value === null || value === ''
        || (Array.isArray(value) && !value.length)
        || (typeof value === 'object' && !Array.isArray(value) && !Object.keys(value).length);
      // `failures` and `at` are the exceptions: an empty failure list is a real claim, and 0 is a
      // legitimate logical time.
      if (field === 'failures' && Array.isArray(value)) continue;
      if (field === 'at' && Number.isFinite(value)) continue;
      if (empty) this._fail(`a '${state}' transition requires '${field}' — a state marked complete because a field exists is not evidence`);
    }
  }

  plan(exerciseId, {
    scenario, capability, responsibleAuthority, intendedSuccessor, scope, prerequisites = [],
    declaredBy, at = null,
  } = {}) {
    if (!exerciseId) this._fail('an exercise must have an identifier');
    if (this._exercises.has(exerciseId)) this._fail(`exercise '${exerciseId}' is already declared — a duplicate succession attempt is a failure mode, not a re-declaration`);
    if (!declaredBy) this._fail(`'${exerciseId}' must name who declared it`);
    const t = at ?? this._clock();
    const evidence = { exerciseId, scenario, capability, responsibleAuthority, intendedSuccessor, scope, prerequisites };
    this._assertTransition(null, 'PLANNED');
    this._assertEvidence('PLANNED', evidence);
    const rec = {
      exerciseId, state: 'PLANNED', declaredBy, plannedAt: t,
      evidence: { PLANNED: { ...evidence, declaredBy, at: t } },
      history: [{ from: null, to: 'PLANNED', at: t, by: declaredBy }],
      clock: { authorityUnavailableAt: null, initiatedAt: null, successorConfirmedAt: null, restoredAt: null },
    };
    this._exercises.set(exerciseId, rec);
    return this.get(exerciseId);
  }

  // Records what happened, including what failed. A failed rehearsal is a rehearsal.
  rehearse(exerciseId, {
    participants = [], actions = [], outcome, failures = [], runBy,
    authorityUnavailableAt = null, initiatedAt = null, successorConfirmedAt = null, at = null,
  } = {}) {
    const rec = this._exercises.get(exerciseId);
    if (!rec) this._fail(`unknown exercise '${exerciseId}'`);
    if (!runBy) this._fail('a rehearsal must name who ran it');
    if (!['completed', 'failed', 'abandoned'].includes(String(outcome))) {
      this._fail("a rehearsal outcome must be 'completed', 'failed' or 'abandoned' — an unstated outcome reads as success");
    }
    for (const f of failures) {
      if (!SUCCESSION_FAILURE_MODES[f && f.mode]) this._fail(`'${f && f.mode}' is not a recognised failure mode`);
    }
    const t = at ?? this._clock();
    this._assertTransition(rec.state, 'REHEARSED');
    const evidence = { participants, actions, outcome, failures, at: t, runBy };
    this._assertEvidence('REHEARSED', evidence);
    rec.state = 'REHEARSED';
    rec.evidence.REHEARSED = evidence;
    rec.history.push({ from: 'PLANNED', to: 'REHEARSED', at: t, by: runBy });
    rec.clock.authorityUnavailableAt = authorityUnavailableAt;
    rec.clock.initiatedAt = initiatedAt;
    rec.clock.successorConfirmedAt = successorConfirmedAt;
    return this.get(exerciseId);
  }

  // What the machine can work out on its own: whether the declared criteria were met. It stops
  // there. AUTOMATED_EVIDENCE_READY is not a verification and is named so nobody can read it as one.
  automatedEvidence(exerciseId, { criteria = [], now = null } = {}) {
    const rec = this._exercises.get(exerciseId);
    if (!rec) this._fail(`unknown exercise '${exerciseId}'`);
    const t = now ?? this._clock();
    const r = rec.evidence.REHEARSED || null;
    const results = criteria.map((c) => {
      const met = typeof c.met === 'function' ? !!c.met(rec) : c.met === true;
      return { criterion: c.id || c.criterion, description: c.description || null, met };
    });
    const unresolved = results.filter((x) => !x.met).map((x) => x.criterion);
    const ready = !!r && r.outcome === 'completed' && results.length > 0 && unresolved.length === 0;
    return {
      exerciseId, state: rec.state,
      criteriaResults: results, unresolvedFindings: unresolved,
      rehearsalOutcome: r ? r.outcome : null,
      rehearsalFailures: r ? r.failures.map((f) => f.mode) : [],
      // The whole point of this method's name.
      status: ready ? 'AUTOMATED_EVIDENCE_READY' : 'AUTOMATED_EVIDENCE_INCOMPLETE',
      humanVerificationRequired: 'HUMAN_VERIFICATION',
      establishesVerification: false, authorizes: false,
      now: t,
      note: 'A machine can evaluate whether declared criteria were met. It cannot decide that an institution is ready, and AUTOMATED_EVIDENCE_READY is deliberately not a verification state — no code path turns it into one.',
    };
  }

  // VERIFIED needs a human, and not the one who ran the drill.
  verify(exerciseId, { criteria = [], criteriaResults = null, evaluator, decision, evidenceIntegrity, at = null } = {}) {
    const rec = this._exercises.get(exerciseId);
    if (!rec) this._fail(`unknown exercise '${exerciseId}'`);
    const t = at ?? this._clock();
    this._assertTransition(rec.state, 'VERIFIED');
    if (!evaluator) this._fail('verification requires a named evaluator — an unsigned verification is an assertion that somebody agreed');
    const runBy = rec.evidence.REHEARSED && rec.evidence.REHEARSED.runBy;
    if (evaluator === runBy) this._fail(`'${evaluator}' ran the exercise and cannot verify it — verification that the runner can generate is not verification`);
    if (!['verified', 'not-verified'].includes(String(decision))) this._fail("a verification decision must be 'verified' or 'not-verified'");
    const auto = this.automatedEvidence(exerciseId, { criteria, now: t });
    const results = criteriaResults || auto.criteriaResults;
    const evidence = { criteria: criteria.map((c) => c.id || c.criterion), criteriaResults: results, evaluator, decision, evidenceIntegrity };
    this._assertEvidence('VERIFIED', evidence);
    // A rehearsal that failed cannot be verified as successful. Fail closed.
    if (decision === 'verified' && rec.evidence.REHEARSED.outcome !== 'completed') {
      this._fail(`exercise '${exerciseId}' was recorded as '${rec.evidence.REHEARSED.outcome}' and cannot be verified as successful — a failed exercise represented as verified is the one outcome this register exists to prevent`);
    }
    if (decision === 'verified' && auto.unresolvedFindings.length) {
      this._fail(`${auto.unresolvedFindings.length} declared criterion(s) were not met: ${auto.unresolvedFindings.join(', ')} — verification requires its criteria, not a signature`);
    }
    rec.state = 'VERIFIED';
    rec.evidence.VERIFIED = { ...evidence, at: t, automatedStatus: auto.status };
    rec.history.push({ from: 'REHEARSED', to: 'VERIFIED', at: t, by: evaluator });
    return this.get(exerciseId);
  }

  restore(exerciseId, { restoredTo, restoredBy, restorationEvent, governanceConfirmation, at = null } = {}) {
    const rec = this._exercises.get(exerciseId);
    if (!rec) this._fail(`unknown exercise '${exerciseId}'`);
    const t = at ?? this._clock();
    this._assertTransition(rec.state, 'AUTHORITY_RESTORED');
    const evidence = { restoredTo, restoredBy, restorationEvent, governanceConfirmation, at: t };
    this._assertEvidence('AUTHORITY_RESTORED', evidence);
    if (rec.evidence.VERIFIED.decision !== 'verified') {
      this._fail(`exercise '${exerciseId}' was evaluated as '${rec.evidence.VERIFIED.decision}' and authority cannot be restored on it`);
    }
    const primary = rec.evidence.PLANNED.responsibleAuthority;
    if (restoredTo !== primary) {
      this._fail(`authority was restored to '${restoredTo}' and the primary office is '${primary}' — an acting holder keeping the office is the failure this state exists to detect`);
    }
    rec.state = 'AUTHORITY_RESTORED';
    rec.evidence.AUTHORITY_RESTORED = evidence;
    rec.history.push({ from: 'VERIFIED', to: 'AUTHORITY_RESTORED', at: t, by: restoredBy });
    rec.clock.restoredAt = t;
    return this.get(exerciseId);
  }

  // Time to Authority Restoration, from the logical clock. Reported in clock units, never wall time,
  // and UNKNOWN wherever a marker was not recorded. A duration derived from a missing marker would
  // be a number that looks measured.
  ttar(exerciseId) {
    const rec = this._exercises.get(exerciseId);
    if (!rec) this._fail(`unknown exercise '${exerciseId}'`);
    const c = rec.clock;
    const markers = [
      { marker: 'authority-unavailable', at: c.authorityUnavailableAt },
      { marker: 'succession-initiated', at: c.initiatedAt },
      { marker: 'successor-confirmed', at: c.successorConfirmedAt },
      { marker: 'authority-restored', at: c.restoredAt },
    ];
    const missing = markers.filter((m) => !Number.isFinite(m.at)).map((m) => m.marker);
    const ordered = missing.length ? null : markers.every((m, i) => i === 0 || m.at >= markers[i - 1].at);
    return {
      exerciseId, markers, missing,
      ordered,
      duration: missing.length || ordered === false ? null : c.restoredAt - c.authorityUnavailableAt,
      segments: missing.length ? [] : [
        { segment: 'detection-to-initiation', ticks: c.initiatedAt - c.authorityUnavailableAt },
        { segment: 'initiation-to-confirmation', ticks: c.successorConfirmedAt - c.initiatedAt },
        { segment: 'confirmation-to-restoration', ticks: c.restoredAt - c.successorConfirmedAt },
      ],
      state: missing.length ? 'UNKNOWN' : ordered === false ? 'BROKEN' : 'RESOLVED',
      detail: missing.length ? `${missing.length} marker(s) were not recorded: ${missing.join(', ')} — a duration derived from a missing marker is a number that looks measured`
        : ordered === false ? 'the recorded markers are out of order, so the elapsed time is not a duration'
          : `${c.restoredAt - c.authorityUnavailableAt} logical tick(s) from authority becoming unavailable to authority being restored`,
      unit: 'logical clock ticks',
      // A number never moves a governance decision on its own.
      informsGovernance: false, authorizes: false,
      note: 'Measured on the injected logical clock so identical inputs give an identical figure. TTAR is a measurement and not a threshold: nothing here compares it to a target or changes a state because of it.',
    };
  }

  get(exerciseId) {
    const r = this._exercises.get(exerciseId);
    if (!r) return null;
    return JSON.parse(JSON.stringify({ ...r, ttarState: undefined }));
  }
  exercises() { return [...this._exercises.keys()].sort().map((id) => this.get(id)); }
  // Exercises that reached a state, for the assurance ladder to read.
  inState(state) { return this.exercises().filter((e) => e.state === state); }
  // An exercise counts as rehearsed for a subsystem once it has been run at all.
  forCapability(capability) { return this.exercises().filter((e) => e.evidence.PLANNED.capability === capability); }
  states() { return Object.entries(SUCCESSION_EXERCISE_STATES).map(([state, s]) => ({ state, ...s })); }
  transitions() { return SUCCESSION_TRANSITIONS.map((t) => ({ ...t })); }
}

// --- Governance succession assurance (Phase 18.1 close-out remediation R6/R9) ---------------------
//
// Four things are routinely called "we have succession", and they are not the same thing. Conflating
// any two of them is how an institution discovers during an outage that its plan was a diagram.
//
//   DOCUMENTED  a chain exists, with named holders at each level
//   EXECUTABLE  every level resolves to a real accountable holder and the chain ends at a body
//   REHEARSED   somebody has actually walked it, attested by a named human
//   VERIFIED    a human recorded that the walk achieved authority transfer
//
// Each level requires the ones before it. None of them implies the one after. That asymmetry is the
// whole point: DOCUMENTED is cheap and the platform has it everywhere; REHEARSED is expensive and
// the platform has it nowhere. A control that reported "succession: yes" would be true of the first
// and false of the last, and the reader would take the reassuring reading.
//
// SUCCESSION DESIGN IS NOT SUCCESSION PROOF.
const SUCCESSION_ASSURANCE_LEVELS = {
  DOCUMENTED: {
    order: 1, establishedBy: 'machine', epistemic: 'RESOLVED',
    means: 'A chain exists with a named holder at each level.',
    doesNotEstablish: 'That any of those holders could actually take over.',
  },
  EXECUTABLE: {
    order: 2, establishedBy: 'machine', epistemic: 'RESOLVED',
    means: 'Every level resolves to a holder the accountability record knows, and the chain terminates at a body rather than a person.',
    doesNotEstablish: 'That anybody has ever done it.',
  },
  REHEARSED: {
    order: 3, establishedBy: 'record of a human act', epistemic: 'RESOLVED',
    means: 'A governance-succession exercise is recorded, attested by a named human other than the participant.',
    doesNotEstablish: 'That the rehearsal worked. An exercise can be run and fail.',
  },
  VERIFIED: {
    order: 4, establishedBy: 'human judgement', epistemic: 'RESOLVED',
    means: 'A named human recorded that the rehearsal achieved authority transfer at every level walked.',
    doesNotEstablish: 'That it will work next time, with different people, under real pressure.',
  },
};
const SUCCESSION_ASSURANCE_ORDER = ['DOCUMENTED', 'EXECUTABLE', 'REHEARSED', 'VERIFIED'];

// The stages a governance-succession drill walks. Deterministic and synthetic: this describes a
// rehearsal shape, and running it proves the shape is walkable — never that anyone has walked it.
const SUCCESSION_STAGES = [
  { stage: 'primary-unavailable', asks: 'The primary accountable office cannot act. Does the record say who is next?' },
  { stage: 'first-successor-assumes', asks: 'Can the first successor assume the authority, and is the transfer recorded?' },
  { stage: 'first-successor-unavailable', asks: 'The first successor also cannot act. Does the chain continue?' },
  { stage: 'second-successor-assumes', asks: 'Can the second successor assume the authority?' },
  { stage: 'second-successor-unavailable', asks: 'The second successor cannot act either. Is there a body to fall back to?' },
  { stage: 'body-fallback', asks: 'Can the board sit as a body, and does quorum apply rather than a single signature?' },
  { stage: 'authority-restored', asks: 'When the primary returns, does authority go back, and is the interregnum auditable?' },
];

// What a drill must exercise beyond the walk itself. Each is checked from the records rather than
// asserted, and each says plainly what it cannot establish.
const SUCCESSION_CHECKS = {
  successionOrder: { asks: 'Is the order unambiguous and stable?', from: 'successionPlan()' },
  authorityTransfer: { asks: 'Does each level hold the authority the previous one held?', from: 'the accountability record' },
  raciChange: { asks: 'Does the RACI row change when authority moves?', from: 'raci.matrixFor()' },
  decisionRights: { asks: 'Can the acting holder take the decisions the office takes?', from: 'raci activities' },
  quorum: { asks: 'Does the body fallback require a quorum rather than one signature?', from: 'the chain basis' },
  escalation: { asks: 'Does escalation still terminate at a board during the interregnum?', from: 'escalationPath()' },
  decisionRecording: { asks: 'Is a decision taken under succession distinguishable from a normal one?', from: 'the governance decision record' },
  evidenceCustody: { asks: 'Does custody of evidence survive the transfer?', from: 'the custody chain' },
  auditTrail: { asks: 'Can the interregnum be reconstructed afterwards?', from: 'the recorded exercise' },
  restoration: { asks: 'Does normal authority resume, or does the acting holder keep it by inertia?', from: 'the chain' },
};

// Walks a governance succession chain. Uses the shared first-break walker rather than a private one:
// a succession chain IS a sequential assurance chain, and a second traversal engine here would be
// the duplication ADR-0014 exists to prevent.
function successionExercise(subsystem, { role = 'approvingAuthority', unavailable = [], exercises = null, now = 0 } = {}) {
  const { assuranceChain, machineBoundary } = require('../assurance/epistemic');
  const raci = require('./raci');
  const plan = successionPlan(subsystem, role);
  const o = OWNERSHIP[subsystem];
  const boardName = BOARDS[o.governanceBoard].name;
  const holders = plan.chain.map((c) => c.holder);
  const out = new Set(unavailable);

  // Everyone the accountability record actually knows about.
  const known = new Set(subsystems().flatMap((s) => {
    const d = describe(s);
    return [d.operationalOwner, d.approvingAuthority, d.responsibleAuthority, d.dataSteward, d.board && d.board.name].filter(Boolean);
  }));
  // A deputy is named by rule rather than held as a subsystem role, so it is known if it is named.
  for (const c of plan.chain) if (c.basis === 'named deputy' && c.holder) known.add(c.holder);

  // Walk the stages. A stage resolves when the record answers it; it is BROKEN when the record
  // answers it wrongly, and UNKNOWN when nothing in the record settles it.
  const acting = () => holders.find((h) => !out.has(h)) || null;
  const steps = SUCCESSION_STAGES.map((s) => {
    const level = { 'first-successor-assumes': 1, 'second-successor-assumes': 2, 'body-fallback': 2 }[s.stage];
    switch (s.stage) {
      case 'primary-unavailable':
      case 'first-successor-unavailable':
      case 'second-successor-unavailable': {
        const idx = { 'primary-unavailable': 0, 'first-successor-unavailable': 1, 'second-successor-unavailable': 2 }[s.stage];
        const next = plan.chain[idx + 1] || null;
        return {
          step: s.stage, ...s,
          state: next ? 'RESOLVED' : (plan.chain[idx].holder === boardName ? 'RESOLVED' : 'BROKEN'),
          detail: next ? `next is '${next.holder}' (${next.basis})`
            : plan.chain[idx].holder === boardName ? 'the chain has reached the body, which is the terminal authority'
              : 'the chain runs out with no body behind it',
          ifBroken: 'The chain ends in a person, so it can end in nobody.',
          resolvedFrom: 'successionPlan()',
        };
      }
      case 'first-successor-assumes':
      case 'second-successor-assumes': {
        const c = plan.chain[level];
        const holder = c && c.holder;
        return {
          step: s.stage, ...s,
          state: !holder ? 'BROKEN' : !known.has(holder) ? 'UNKNOWN' : out.has(holder) ? 'BROKEN' : 'RESOLVED',
          detail: !holder ? 'no holder is named at this level'
            : !known.has(holder) ? `'${holder}' is named and holds nothing the accountability record knows — whether they could assume the authority is unestablished`
              : out.has(holder) ? `'${holder}' is also unavailable`
                : `'${holder}' assumes the authority as ${c.basis}`,
          ifBroken: 'Authority stops here and the office is unfilled.',
          resolvedFrom: 'the accountability record',
        };
      }
      case 'body-fallback': {
        const terminal = plan.chain[plan.chain.length - 1];
        const quorate = /quorum/.test(String(terminal.basis));
        return {
          step: s.stage, ...s,
          state: !plan.terminatesAtBoard ? 'BROKEN' : quorate ? 'RESOLVED' : 'UNKNOWN',
          detail: !plan.terminatesAtBoard ? 'the chain does not terminate at a body'
            : quorate ? `'${terminal.holder}' sits as a body, quorum required — a quorate board and a chair acting alone are different authorities`
              : `'${terminal.holder}' is the terminal authority and nothing states whether a quorum is required`,
          ifBroken: 'The fallback is a person with a board\'s title.',
          resolvedFrom: 'the chain basis',
        };
      }
      case 'authority-restored': {
        // Restoration is not a thing the record can settle. A chain says who acts while the primary
        // is away; nothing in it says the primary gets the office back, and "acting" roles becoming
        // permanent by inertia is a real institutional failure mode.
        return {
          step: s.stage, ...s,
          state: 'UNKNOWN',
          detail: 'nothing recorded states that authority returns to the primary, or how the interregnum is closed — a succession chain describes who acts, not how acting ends',
          ifBroken: 'An acting holder keeps the office by inertia and nobody decided that.',
          resolvedFrom: 'a recorded restoration procedure, which does not exist',
        };
      }
      default:
        return { step: s.stage, ...s, state: 'UNKNOWN', detail: 'unrecognised stage', ifBroken: null, resolvedFrom: null };
    }
  });

  const walk = assuranceChain(steps, { subject: `${subsystem}/${role}`, now });

  // The four levels. Each is established independently; none is inferred from another.
  const documented = plan.chain.length > 0 && plan.chain.every((c) => !!c.holder);
  const executable = documented && plan.chain.every((c) => known.has(c.holder)) && plan.terminatesAtBoard;
  // Two evidence sources, one meaning. The participation register records WHO attended a
  // governance-succession exercise; the exercise register records WHAT an exercise did and how far
  // it got. Either establishes that a rehearsal happened, and the ladder reads both rather than
  // keeping a third idea of what has been rehearsed.
  const participationRecords = exercises && typeof exercises.participation === 'function'
    ? exercises.participation().filter((r) => r.exercise === 'governance-succession')
    : [];
  const exerciseRecords = exercises && typeof exercises.exercises === 'function'
    ? exercises.exercises().filter((e) => e.state !== 'PLANNED')
    : [];
  const rehearsalRecords = [
    ...participationRecords,
    // An exercise that reached VERIFIED with a positive decision carries its evaluator as the
    // attesting human, which is exactly what the ladder's VERIFIED level asks for.
    ...exerciseRecords.map((e) => ({
      person: e.evidence.REHEARSED ? e.evidence.REHEARSED.runBy : e.declaredBy,
      exercise: 'governance-succession',
      at: e.evidence.REHEARSED ? e.evidence.REHEARSED.at : e.plannedAt,
      by: e.evidence.VERIFIED ? e.evidence.VERIFIED.evaluator : null,
      outcome: e.evidence.VERIFIED && e.evidence.VERIFIED.decision === 'verified' && e.evidence.REHEARSED.outcome === 'completed' ? 'completed' : 'failed',
    })),
  ];
  const rehearsed = rehearsalRecords.length > 0;
  // A rehearsal that HAPPENED is not a rehearsal that WORKED, and that gap is where the two top
  // levels differ. REHEARSED counts any recorded walk, including one that failed — a failed drill is
  // evidence and belongs in the record. VERIFIED needs a completed outcome attested by somebody
  // other than the person who took part, because self-reported success attests nothing.
  const verifiedRecords = rehearsalRecords.filter((r) => r.outcome === 'completed' && r.by && r.by !== r.person);
  const verified = verifiedRecords.length > 0;

  const attained = executable ? (rehearsed ? (verified ? 'VERIFIED' : 'REHEARSED') : 'EXECUTABLE') : documented ? 'DOCUMENTED' : null;
  const nextLevel = attained ? SUCCESSION_ASSURANCE_ORDER[SUCCESSION_ASSURANCE_ORDER.indexOf(attained) + 1] || null : 'DOCUMENTED';

  return {
    subsystem, role, plan, stages: walk.steps, walk,
    levels: SUCCESSION_ASSURANCE_ORDER.map((id) => ({
      level: id, ...SUCCESSION_ASSURANCE_LEVELS[id],
      attained: SUCCESSION_ASSURANCE_LEVELS[id].order <= (attained ? SUCCESSION_ASSURANCE_LEVELS[attained].order : 0),
    })),
    documented, executable, rehearsed, verified,
    attainedLevel: attained, nextLevel,
    rehearsalCount: rehearsalRecords.length,
    checks: Object.entries(SUCCESSION_CHECKS).map(([check, c]) => ({ check, ...c })),
    // The RACI row moves with the authority; reported so a reader can see it does.
    raciUnderSuccession: (() => {
      try {
        const m = raci.matrixFor(subsystem);
        return { subsystem, activities: m.rows.length, accountableNow: plan.chain[0].holder, accountableIfUnavailable: plan.chain[1].holder };
      } catch (_) { return null; }
    })(),
    escalationStillTerminates: (() => { try { return escalationPath(subsystem).terminatesAt === o.governanceBoard; } catch (_) { return null; } })(),
    contiguousNavigableDepth: walk.contiguousNavigableDepth,
    resolvedCount: walk.resolvedCount,
    stoppedAt: walk.stoppedAt,
    ...machineBoundary({
      observed: [
        'whether a chain exists and names a holder at every level',
        'whether each named holder appears in the accountability record',
        'whether the chain terminates at a body and whether quorum is stated',
        'whether any governance-succession exercise has been recorded',
      ],
      judged: [
        'whether a rehearsal actually achieved authority transfer',
        'whether the people named would in fact act under real pressure',
        'whether an interregnum was closed properly',
      ],
    }),
    now, informationalOnly: true, authorizes: false,
    note: 'DOCUMENTED, EXECUTABLE, REHEARSED and VERIFIED are established separately and none implies the next. A chain that walks cleanly on paper proves the paper, and this platform has never recorded a governance-succession rehearsal — so no subsystem is above EXECUTABLE, and reporting one as resilient on the strength of its diagram would be the substitution this whole model exists to refuse.',
  };
}

// Every subsystem's succession assurance, weakest-first. Nothing aggregates to a score.
function successionAssurance({ role = 'approvingAuthority', exercises = null, now = 0 } = {}) {
  const rows = subsystems().map((s) => {
    const r = successionExercise(s, { role, exercises, now });
    return {
      subsystem: s, attainedLevel: r.attainedLevel, nextLevel: r.nextLevel,
      documented: r.documented, executable: r.executable, rehearsed: r.rehearsed, verified: r.verified,
      contiguousNavigableDepth: r.contiguousNavigableDepth, stoppedAt: r.stoppedAt,
      rehearsalCount: r.rehearsalCount,
    };
  });
  const at = (level) => rows.filter((r) => r.attainedLevel === level).map((r) => r.subsystem);
  return {
    role, subsystems: rows, count: rows.length,
    levels: SUCCESSION_ASSURANCE_ORDER.map((id) => ({ level: id, ...SUCCESSION_ASSURANCE_LEVELS[id], subsystems: at(id) })),
    documented: rows.filter((r) => r.documented).length,
    executable: rows.filter((r) => r.executable).length,
    rehearsed: rows.filter((r) => r.rehearsed).length,
    verified: rows.filter((r) => r.verified).length,
    neverRehearsed: rows.filter((r) => !r.rehearsed).map((r) => r.subsystem),
    // The weakest level any subsystem has reached. Never a mean, never a percentage.
    weakestLevel: SUCCESSION_ASSURANCE_ORDER.find((l) => rows.some((r) => r.attainedLevel === l)) || null,
    basis: rows.length
      ? `${rows.filter((r) => r.documented).length} documented, ${rows.filter((r) => r.executable).length} executable, ${rows.filter((r) => r.rehearsed).length} rehearsed, ${rows.filter((r) => r.verified).length} verified, of ${rows.length} subsystem(s).`
      : 'No subsystem was examined.',
    now, informationalOnly: true, authorizes: false,
    note: 'A documented chain is not a rehearsed one. This platform has recorded no governance-succession rehearsal, so the rehearsed and verified counts are zero and are reported as zero rather than omitted.',
  };
}

module.exports = {
  SUCCESSION_ASSURANCE_LEVELS, SUCCESSION_ASSURANCE_ORDER, SUCCESSION_STAGES, SUCCESSION_CHECKS,
  SUCCESSION_EXERCISE_STATES, SUCCESSION_TRANSITIONS, SUCCESSION_FAILURE_MODES, SuccessionExerciseRegister,
  successionExercise, successionAssurance,
  CAPABILITY_DOMAINS, CAPABILITY_LEVELS, CAPABILITY_ORDER, capabilityMaturity, maturityEvolution, capabilityEvolution,
  OWNERSHIP, BOARDS, ROLES, DEPUTY_ROLES, DEPUTY_RULE, DEPUTY_OVERRIDES, REVIEW_CADENCE_DAYS,
  subsystems, describe, boards, escalationPath, accountabilityFor, validate, model,
  deputyOf, deputies, AvailabilityRegister, successionPlan, reviewSchedule,
  coverageScore, ownershipGaps, continuityReport,
  ACTIVITY_BANDS, GOVERNANCE_ACTS, REQUIRED_TRAINING, TRAINING_VALIDITY_DAYS, ESCALATION_STATES,
  ActivityRegister, TrainingRegister, EscalationWorkflow, activeCoverage, continuityDashboard,
  EXERCISE_KINDS, EXERCISE_VALIDITY_DAYS, EXPERIENCE_WINDOW_DAYS,
  ExerciseRegister, roleReadiness, knowledgeContinuity, trainingAssurance,
};
