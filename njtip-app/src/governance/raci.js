'use strict';
// Operational Governance (Phase 10, Part 13). RACI matrices, ownership validation, decision
// traceability, governance scorecards, escalation workflows, control ownership and operational
// maturity — computed from the ownership model rather than maintained as a parallel spreadsheet.
//
// The rule this module enforces: NO SUBSYSTEM MAY APPROVE ITSELF. That is checked structurally
// (the responsible authority is never the accountable approver) and per decision type.
//
// Deterministic; derived from data, never hand-entered.
const ownership = require('./ownership');
const contextMap = require('../architecture/context-map');

// RACI roles. Exactly one Accountable per activity — that is what makes RACI worth doing.
const RACI_ROLES = { R: 'Responsible — does the work', A: 'Accountable — answers for the outcome (exactly one)', C: 'Consulted — two-way input before the decision', I: 'Informed — told after the decision' };

// The governance activities the platform actually performs, and how each maps onto the
// ownership model. `accountable` and `responsible` are resolved per subsystem at build time.
const ACTIVITIES = {
  'production-deployment': { description: 'Authorize a production release', accountable: 'approvingAuthority', responsible: 'operationalOwner', consulted: ['dataSteward'], informed: ['governanceBoard'], humanDecision: true, evidence: 'continuous assurance package + recorded governance decision' },
  'architecture-change': { description: 'Change a frozen baseline component', accountable: 'approvingAuthority', responsible: 'responsibleAuthority', consulted: ['operationalOwner'], informed: ['dataSteward'], humanDecision: true, evidence: 'ADR + green Twin gate + updated context map' },
  'policy-change': { description: 'Publish a new access-policy set', accountable: 'approvingAuthority', responsible: 'operationalOwner', consulted: ['responsibleAuthority'], informed: ['governanceBoard'], humanDecision: true, evidence: 'PAP publication record + formal policy proofs' },
  'data-exchange-approval': { description: 'Approve a dataset exchange with another body', accountable: 'dataSteward', responsible: 'operationalOwner', consulted: ['responsibleAuthority'], informed: ['governanceBoard'], humanDecision: true, evidence: 'purpose-limited agreement with a named approver' },
  'incident-response': { description: 'Declare and run a major incident', accountable: 'responsibleAuthority', responsible: 'operationalOwner', consulted: ['approvingAuthority'], informed: ['governanceBoard'], humanDecision: true, evidence: 'incident record + recovery authorization' },
  'recovery-authorization': { description: 'Authorize execution of a recovery strategy', accountable: 'approvingAuthority', responsible: 'operationalOwner', consulted: ['responsibleAuthority'], informed: ['governanceBoard'], humanDecision: true, evidence: 'named authorization with rationale' },
  'risk-acceptance': { description: 'Accept a blocked release or an open risk', accountable: 'approvingAuthority', responsible: 'responsibleAuthority', consulted: ['operationalOwner'], informed: ['governanceBoard'], humanDecision: true, evidence: 'recorded acceptance with rationale' },
  'key-custody': { description: '🔒 Generate, rotate or retire production key material', accountable: 'approvingAuthority', responsible: 'operationalOwner', consulted: ['responsibleAuthority'], informed: ['governanceBoard'], humanDecision: true, evidence: 'ISRB sign-off; keys never machine-generated' },
  'legislative-enactment': { description: 'Enact or repeal a legal instrument', accountable: 'approvingAuthority', responsible: 'responsibleAuthority', consulted: ['dataSteward'], informed: ['governanceBoard'], humanDecision: true, evidence: 'simulation report + enactment by a named authority' },
  'ai-model-approval': { description: 'Approve an AI artifact for use', accountable: 'approvingAuthority', responsible: 'responsibleAuthority', consulted: ['dataSteward'], informed: ['governanceBoard'], humanDecision: true, evidence: 'risk classification + explainability + approval record' },
};

// Maturity levels for operational governance, with what each actually requires.
const MATURITY_LEVELS = [
  { level: 1, name: 'Ad hoc', requires: 'Ownership exists somewhere, mostly in people\'s heads.' },
  { level: 2, name: 'Defined', requires: 'Every subsystem has a named owner and approver recorded as data.' },
  { level: 3, name: 'Enforced', requires: 'Separation of duties is checked mechanically; escalation terminates at a board.' },
  { level: 4, name: 'Evidenced', requires: 'Every governance activity names the evidence it produces, and the evidence is machine-verifiable.' },
  { level: 5, name: 'Continuously assured', requires: 'Governance state is re-verified on every build and a failure blocks the build.' },
];

function activities() { return Object.entries(ACTIVITIES).map(([id, a]) => ({ id, ...a, consulted: [...a.consulted], informed: [...a.informed] })); }

// The RACI matrix for one subsystem: every activity resolved to real institutions.
function matrixFor(subsystem) {
  const o = ownership.describe(subsystem);
  const resolve = (role) => (role === 'governanceBoard' ? o.board.name : o[role]);
  return {
    subsystem, context: subsystem,
    rows: activities().map((a) => ({
      activity: a.id, description: a.description,
      responsible: resolve(a.responsible),
      accountable: resolve(a.accountable),
      consulted: a.consulted.map(resolve),
      informed: a.informed.map(resolve),
      humanDecision: a.humanDecision, evidence: a.evidence,
      selfApproval: resolve(a.responsible) === resolve(a.accountable),
    })),
  };
}
function matrix() { return ownership.subsystems().map(matrixFor); }

// Control ownership: which context owns each fitness function, via the module that defines it.
function controlOwnership(fitnessIds = []) {
  const byPrefix = [
    { match: /^FIT-IDENTITY|^APP-FIT-ANONYMITY|^APP-FIT-PRIVACY|^APP-FIT-ANALYTICS-PRIVACY|^APP-FIT-TRACE-PRIVACY|^APP-FIT-GEO/, context: 'privacy' },
    { match: /^APP-FIT-AUTHZ|^APP-FIT-OIDC|^APP-FIT-CREDENTIAL|^APP-FIT-SECRETS|^APP-FIT-DIGITAL-IDENTITY|^APP-FIT-ZERO-TRUST|^FIT-ZERO-TRUST|^FIT-LEAST/, context: 'identity-access' },
    { match: /^APP-FIT-POLICY|^APP-FIT-FORMAL|^FIT-POLICY/, context: 'policy-governance' },
    { match: /^APP-FIT-CIPHERTEXT|^APP-FIT-CRYPTO|^APP-FIT-QUANTUM|^FIT-ENCRYPTION/, context: 'crypto-agility' },
    { match: /^APP-FIT-CUSTODY|^FIT-CHAIN-OF-CUSTODY/, context: 'custody' },
    { match: /^APP-FIT-EVENT|^APP-FIT-PII-FREE|^FIT-SECURE-DATA-FLOWS/, context: 'platform-events' },
    { match: /^APP-FIT-SRE|^APP-FIT-OBSERVABILITY|^APP-FIT-EXECUTIVE|^APP-FIT-BUSINESS|^APP-FIT-MISSION|^APP-FIT-TRUST-EVIDENCE|^APP-FIT-INSTITUTIONAL-CHAIN|^APP-FIT-TEMPORAL-MISSION-IMPACT|^APP-FIT-PUBLIC-TRUST/, context: 'observability' },
    { match: /^APP-FIT-CHAOS|^APP-FIT-RESILIENCE|^APP-FIT-NATIONAL-RESILIENCE|^APP-FIT-RECOVERY|^APP-FIT-MULTI-REGION|^APP-FIT-CONSISTENCY|^APP-FIT-CRISIS|^APP-FIT-OPERATIONS-TWIN|^APP-FIT-ORGANIZATIONAL-TWIN|^APP-FIT-TWIN-CONFIDENCE|^APP-FIT-TWIN-CALIBRATION|^APP-FIT-TWIN-LEARNING|^APP-FIT-STRATEGIC-SCENARIOS/, context: 'resilience' },
    { match: /^APP-FIT-SUPPLY-CHAIN/, context: 'supply-chain' },
    { match: /^APP-FIT-DATA-GOVERNANCE|^APP-FIT-DATA-QUALITY|^APP-FIT-PROVENANCE/, context: 'data-fabric' },
    { match: /^APP-FIT-DATA-EXCHANGE|^APP-FIT-LEGISLATION-MARKETPLACE/, context: 'data-exchange' },
    { match: /^APP-FIT-LEGISLATIVE|^APP-FIT-COMPLIANCE-INTELLIGENCE|^APP-FIT-COMPLIANCE-LIFECYCLE|^APP-FIT-COMPLIANCE-TRANSITIONS|^APP-FIT-REGULATORY-FORECAST|^APP-FIT-LEGAL-AUTHORITY|^APP-FIT-LEGAL-DEPENDENCY-INTELLIGENCE|^APP-FIT-LEGAL-HIERARCHY/, context: 'legislation' },
    { match: /^APP-FIT-AI/, context: 'ai-advisory' },
    { match: /^APP-FIT-THREAT|^APP-FIT-DEVSECOPS|^APP-FIT-RISK/, context: 'security' },
    { match: /^INFRA-FIT|^APP-FIT-INFRA|^APP-FIT-RUNBOOK|^APP-FIT-DOCUMENTATION-ASSURANCE|^APP-FIT-DIAGRAM-ASSURANCE/, context: 'infrastructure' },
    { match: /^APP-FIT-CONTEXT-MAP|^APP-FIT-ZONE-GOVERNANCE|^APP-FIT-ARCHITECTURE-DRIFT|^APP-FIT-ARCHITECTURE-VALIDATION|^APP-FIT-ARCHITECTURE-INTELLIGENCE|^APP-FIT-DRIFT-CLASSIFICATION|^APP-FIT-ADAPTIVE-ANALYTICS|^APP-FIT-FORECAST-CALIBRATION|^APP-FIT-FORECAST-LEARNING|^APP-FIT-MIGRATION|^APP-FIT-PRODUCTION-TRANSITION|^APP-FIT-ACCREDITATION-READINESS|^APP-FIT-ADR|^APP-FIT-MERGE-GOVERNANCE|^APP-FIT-REQUIREMENTS-TRACEABILITY|^APP-FIT-SPECIFICATION-EVOLUTION|^APP-FIT-DUPLICATE-FRAMEWORK|^APP-FIT-ASSUMPTION|^APP-FIT-ASSUMPTION-MATURITY|^APP-FIT-DECISION-MEMORY|^APP-FIT-DECISION-EVOLUTION|^APP-FIT-DECISION-SUPPORT|^APP-FIT-DECISION-QUALITY|^APP-FIT-DECISION-EXPLAINABILITY|^APP-FIT-SPECIFICATION-COMPLIANCE|^APP-FIT-EPISTEMIC-INTEGRITY|^APP-FIT-SYNTHETIC-CORPUS|^APP-FIT-ASSURANCE-API-INTEGRATION|^APP-FIT-INSTITUTIONAL-SUSTAINABILITY|^APP-FIT-CONTINUOUS-ASSURANCE|^APP-FIT-INSTITUTIONAL-ASSURANCE|^APP-FIT-INSTITUTIONAL-PERFORMANCE|^APP-FIT-TRACEABILITY-INVARIANT|^APP-FIT-EVIDENCE-ONBOARDING|^APP-FIT-EVIDENCE-ACQUISITION|^APP-FIT-INSTITUTIONAL-LEARNING|^APP-FIT-VALIDATION-WORKSHOP|^APP-FIT-VALIDATION-INTELLIGENCE|^APP-FIT-STRATEGIC-INTELLIGENCE|^APP-FIT-CONTROL-EFFECTIVENESS|^APP-FIT-CONTROL-PERFORMANCE|^APP-FIT-ADVANCED-CONTROL-ANALYTICS|^APP-FIT-STATISTICAL-CONFIDENCE|^APP-FIT-EVIDENCE|^APP-FIT-EVIDENCE-QUALITY|^APP-FIT-VERIFIED-IMPROVEMENT|^APP-FIT-SOURCE-HEALTH|^APP-FIT-EXPLAINABILITY|^APP-FIT-EXPLAINABILITY-INTELLIGENCE|^APP-FIT-READINESS-EXPLAINABILITY|^APP-FIT-READINESS-TRACEABILITY|^APP-FIT-READINESS|^APP-FIT-ENGINEERING|^APP-FIT-ENTERPRISE|^APP-FIT-TEMPORAL-GRAPH|^FIT-AUDITABILITY/, context: 'assurance' },
    { match: /^APP-FIT-INTEGRATION-CONTRACTS|^APP-FIT-CONSUMER|^APP-FIT-API/, context: 'api-governance' },
    { match: /^APP-FIT-GOVERNANCE|^APP-FIT-KNOWLEDGE-CONTINUITY|^APP-FIT-GOVERNANCE-REHEARSALS|^APP-FIT-EXERCISE-INTELLIGENCE|^APP-FIT-CAPABILITY-MATURITY|^APP-FIT-CAPABILITY-ROADMAP|^APP-FIT-CAPABILITY-EVOLUTION|^APP-FIT-INSTITUTIONAL-RESILIENCE|^APP-FIT-GOVERNANCE-RESILIENCE|^APP-FIT-GLOBAL-INVARIANT|^APP-FIT-DEPENDENCY-RISK|^APP-FIT-DEPENDENCY-INTELLIGENCE|^APP-FIT-GOVERNANCE-OPTIMIZATION|^APP-FIT-RECOMMENDATION-CLASSIFICATION|^APP-FIT-CROSS-AGENCY|^APP-FIT-CROSS-GOVERNMENT|^APP-FIT-WORKFLOW-VALIDATION|^APP-FIT-WORKFLOW-INTELLIGENCE|^APP-FIT-RACI|^FIT-GOVERNANCE|^APP-FIT-EVOLUTION|^APP-FIT-COMMAND/, context: 'governance-oversight' },
    { match: /^APP-FIT-CORRELATION|^APP-FIT-PLATFORM-INTELLIGENCE/, context: 'intelligence' },
    { match: /^APP-FIT-USABILITY|^APP-FIT-SUSTAINABILITY|^APP-FIT-DECLARATION-HISTORY/, context: 'portfolio' },
    { match: /^APP-FIT-NO-IDENTITY-COLUMN|^APP-FIT-PERSISTENCE/, context: 'persistence' },
    { match: /^APP-FIT-LIFECYCLE-DEFAULT-DENY|^APP-FIT-WORKFLOW-INTEGRITY/, context: 'investigation' },
    { match: /^APP-FIT-TENANT-ISOLATION|^APP-FIT-ECOSYSTEM/, context: 'tenancy-federation' },
    { match: /^APP-FIT-GRAPH|^APP-FIT-LEGAL-DEPENDENCY-GRAPH|^APP-FIT-SEMANTIC/, context: 'analytics' },
    { match: /^APP-FIT-KNOWLEDGE/, context: 'knowledge' },
    { match: /^APP-FIT-FORMAL-VERIFICATION|^APP-FIT-PROCESS|^APP-FIT-WORKFLOW-SIMULATION|^APP-FIT-FLAGS/, context: 'orchestration' },
    { match: /^APP-FIT-INTEGRATION-ISOLATION/, context: 'api-governance' },
    // Twin-level constitutional invariants map to the contexts that realize them.
    { match: /^FIT-ZONE-ISOLATION|^FIT-TIME-INTEGRITY/, context: 'persistence' },
    { match: /^FIT-BACKUP/, context: 'infrastructure' },
    { match: /^FIT-EMERGENCY/, context: 'identity-access' },
    { match: /^FIT-TRACEABILITY/, context: 'assurance' },
  ];
  const rows = fitnessIds.map((id) => {
    const hit = byPrefix.find((p) => p.match.test(id));
    const context = hit ? hit.context : null;
    let owner = null;
    if (context) { try { owner = ownership.describe(context); } catch (_) { owner = null; } }
    return { control: id, context, responsibleAuthority: owner ? owner.responsibleAuthority : null, governanceBoard: owner ? owner.governanceBoard : null, owned: !!owner };
  });
  return { controls: rows, unowned: rows.filter((r) => !r.owned).map((r) => r.control), coverage: rows.length ? +(rows.filter((r) => r.owned).length / rows.length).toFixed(3) : 1 };
}

// Escalation workflow for an activity in a subsystem: who acts, who decides, where it ends.
function escalationWorkflow(subsystem, activityId) {
  const a = ACTIVITIES[activityId];
  if (!a) throw new Error('unknown governance activity: ' + activityId);
  const o = ownership.describe(subsystem);
  const path = ownership.escalationPath(subsystem);
  return {
    subsystem, activity: activityId, description: a.description,
    steps: [
      { step: 1, actor: o.operationalOwner, action: 'detects and prepares the decision with its evidence' },
      { step: 2, actor: o.responsibleAuthority, action: 'reviews and recommends' },
      { step: 3, actor: o.approvingAuthority, action: 'decides — this is the accountable step' },
      { step: 4, actor: o.board.name, action: 'is informed, and is the escalation terminal' },
    ],
    terminatesAt: path.terminatesAt, board: o.board.name,
    evidenceRequired: a.evidence, humanDecision: a.humanDecision,
  };
}

// Decision traceability: from a decision type back to who may take it and what evidence it needs.
function decisionTraceability() {
  return activities().map((a) => ({
    decision: a.id, description: a.description,
    accountableRole: a.accountable, responsibleRole: a.responsible,
    evidenceRequired: a.evidence, humanDecision: a.humanDecision,
    subsystemsWhereApplicable: ownership.subsystems().length,
    note: 'The accountable role is resolved per subsystem from the ownership model — one matrix, not thirty spreadsheets.',
  }));
}

// Governance scorecard: computed from the ownership model and the live fitness gate.
function scorecard({ fitnessIds = [], fitnessResults = [] } = {}) {
  const ownershipValidation = ownership.validate();
  const contextValidation = contextMap.validate();
  const control = controlOwnership(fitnessIds);
  const selfApprovals = matrix().flatMap((m) => m.rows.filter((r) => r.selfApproval).map((r) => `${m.subsystem}/${r.activity}`));
  const held = fitnessResults.length ? fitnessResults.filter((r) => r.pass).length / fitnessResults.length : null;
  const dimensions = [
    { dimension: 'ownership-complete', value: ownershipValidation.valid ? 1 : 0, detail: `${ownershipValidation.subsystems} subsystems recorded` },
    { dimension: 'architecture-of-record', value: contextValidation.valid ? 1 : 0, detail: `${contextValidation.contexts} contexts, ${contextValidation.modules} modules owned` },
    { dimension: 'separation-of-duties', value: selfApprovals.length === 0 ? 1 : 0, detail: selfApprovals.length ? `${selfApprovals.length} self-approval(s)` : 'no subsystem approves itself' },
    { dimension: 'control-ownership', value: control.coverage, detail: `${control.unowned.length} unowned control(s)` },
    { dimension: 'evidence-defined', value: activities().every((a) => a.evidence) ? 1 : 0, detail: 'every governance activity names its evidence' },
    { dimension: 'human-decision', value: activities().every((a) => a.humanDecision) ? 1 : 0, detail: 'every governance activity is a human decision' },
  ];
  if (held !== null) dimensions.push({ dimension: 'controls-holding', value: +held.toFixed(3), detail: `${fitnessResults.filter((r) => r.pass).length}/${fitnessResults.length} invariants hold` });
  const score = +(dimensions.reduce((a, d) => a + d.value, 0) / dimensions.length).toFixed(3);
  return { dimensions, score, band: score >= 0.95 ? 'strong' : score >= 0.8 ? 'adequate' : 'weak', selfApprovals, note: 'Computed from the ownership model and the live gate. No value is hand-entered.' };
}

// Operational maturity: the highest level whose requirement the platform actually meets.
function maturity({ fitnessIds = [], fitnessResults = [] } = {}) {
  const s = scorecard({ fitnessIds, fitnessResults });
  const met = {
    1: true,
    2: ownership.validate().valid,
    3: s.selfApprovals.length === 0 && ownership.subsystems().every((sub) => ownership.escalationPath(sub).terminatesAt === ownership.describe(sub).governanceBoard),
    4: activities().every((a) => a.evidence),
    5: fitnessResults.length > 0 && fitnessResults.every((r) => r.pass),
  };
  let level = 1;
  for (const l of [2, 3, 4, 5]) { if (met[l]) level = l; else break; }
  return { level, name: MATURITY_LEVELS[level - 1].name, levels: MATURITY_LEVELS, met, scorecard: s, note: 'Maturity is the highest level whose requirement is actually met, not the highest that is aspired to.' };
}

function validate() {
  const violations = [];
  // Exactly one accountable per activity, and it is never the responsible party.
  for (const a of activities()) {
    if (!a.accountable) violations.push(`${a.id}: no accountable role`);
    if (a.accountable === a.responsible) violations.push(`${a.id}: the responsible role is also accountable — nobody may approve their own work`);
    if (!a.evidence) violations.push(`${a.id}: no evidence is named for this decision`);
    if (a.humanDecision !== true) violations.push(`${a.id}: a governance activity that is not a human decision`);
  }
  // No subsystem may approve itself, resolved to real institutions.
  for (const m of matrix()) for (const row of m.rows) if (row.selfApproval) violations.push(`${m.subsystem}/${row.activity}: the same authority is responsible and accountable`);
  // Every context has a matrix.
  for (const ctx of contextMap.ids()) { try { matrixFor(ctx); } catch (_) { violations.push(`${ctx}: no RACI matrix could be resolved`); } }
  return { valid: violations.length === 0, violations, activities: activities().length, subsystems: ownership.subsystems().length };
}

function report({ fitnessIds = [], fitnessResults = [] } = {}) {
  return {
    raciRoles: RACI_ROLES, activities: activities(),
    matrix: matrix(), decisionTraceability: decisionTraceability(),
    controlOwnership: controlOwnership(fitnessIds),
    scorecard: scorecard({ fitnessIds, fitnessResults }),
    maturity: maturity({ fitnessIds, fitnessResults }),
    validation: validate(),
    authorizes: false,
    note: 'Operational governance derived from the ownership model. No subsystem may approve itself, and every governance activity is a human decision.',
  };
}

module.exports = { RACI_ROLES, ACTIVITIES, MATURITY_LEVELS, activities, matrixFor, matrix, controlOwnership, escalationWorkflow, decisionTraceability, scorecard, maturity, validate, report };
