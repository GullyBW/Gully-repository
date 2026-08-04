'use strict';
// Executive Governance Intelligence (Part 15), Continuous Improvement Intelligence (Part 19) and the
// Institutional Assurance Framework (Part 20). Extends the assurance bounded context.
//
// This is the layer everything else in Phase 13 reports into, which makes it the layer most likely
// to quietly become decoration. Three rules keep it honest.
//
//   1. NO MANUALLY ENTERED EXECUTIVE METRIC. Every panel is a function of a register. There is no
//      parameter anywhere below that lets a caller state a figure; supplying one is an error.
//
//   2. AN UNMEASURED DOMAIN IS REPORTED AS UNMEASURED, NEVER AS SATISFIED. The default state of
//      every assurance domain is that nobody has looked, and a framework that renders that as a
//      green tick is worse than no framework, because it is trusted.
//
//   3. IT PROVES READINESS AND NEVER AUTHORIZES. Thirteen green domains still print NOT AUTHORIZED.
//      Authorization is a recorded decision by a named human, and no aggregate of evidence produces
//      one.
const evidenceConfidence = require('./evidence-confidence');

// A panel is a named question with a derivation. `derivedFrom` is the module that answers it, so a
// reader can go and check the number rather than take it.
const EXECUTIVE_PANELS = {
  institutionalResilience: { question: 'Could the institution survive losing any one person, process, document or system?', derivedFrom: 'src/governance/institutional-resilience.js' },
  governanceMaturity: { question: 'How far has governance moved from declared to continuously assured?', derivedFrom: 'src/assurance/evidence-confidence.js (governanceMaturity)' },
  operationalReadiness: { question: 'Can the platform be run, observed and recovered?', derivedFrom: 'src/assurance/evidence-confidence.js (readinessModel)' },
  missionReadiness: { question: 'Is the platform delivering the outcomes it exists for?', derivedFrom: 'src/observability/business.js' },
  documentationHealth: { question: 'Does the documentation still describe the implementation?', derivedFrom: 'src/architecture/documentation-assurance.js' },
  organizationalContinuity: { question: 'Is there a validated alternative for every accountable role?', derivedFrom: 'src/governance/ownership.js (knowledgeContinuity)' },
  complianceEvolution: { question: 'Are legal obligations moving toward compliance or away from it?', derivedFrom: 'src/legislation/compliance-intelligence.js' },
  knowledgeContinuity: { question: 'Would the institution keep working if the people changed?', derivedFrom: 'src/governance/ownership.js' },
  simulationConfidence: { question: 'How much may we rely on what the twin predicts?', derivedFrom: 'src/twin2/operations-twin.js' },
  assumptionHealth: { question: 'Are the beliefs the platform rests on still being examined?', derivedFrom: 'src/architecture/assumptions.js' },
};

// The thirteen domains Part 20 names. Each declares what it would mean for that domain to be
// unverified — the sentence that stops "unmeasured" being read as "fine".
const ASSURANCE_DOMAINS = {
  architecture: { unverifiedMeans: 'The system may not be the one described, and every other assurance rests on the description.' },
  security: { unverifiedMeans: 'Controls may not hold, and nothing would say so until they were tested by somebody hostile.' },
  privacy: { unverifiedMeans: 'Identity minimisation may have lapsed, which is unrecoverable for the person it happens to.' },
  governance: { unverifiedMeans: 'Decisions may be unattributable, so they cannot be challenged.' },
  documentation: { unverifiedMeans: 'An operator following the runbook may be following something that no longer works.' },
  operationalReadiness: { unverifiedMeans: 'The platform may not be recoverable, and the first test would be an outage.' },
  organizationalReadiness: { unverifiedMeans: 'The people accountable may not be able to act.' },
  institutionalResilience: { unverifiedMeans: 'A single person, document or system may be able to stop a constitutional capability.' },
  training: { unverifiedMeans: 'Somebody may hold a role they are not currently competent to exercise.' },
  knowledgeContinuity: { unverifiedMeans: 'A departure may take a capability with it.' },
  compliance: { unverifiedMeans: 'A legal obligation may be unmet, and discovered at an inspection.' },
  missionReadiness: { unverifiedMeans: 'The platform may be running well and not achieving what it exists for.' },
  evidenceQuality: { unverifiedMeans: 'Every figure above may rest on evidence nobody has assessed.' },
};

// --- Part 19: continuous improvement -------------------------------------------------------------
//
//   Fitness failure → root cause → corrective action → ADR → verification → operational outcome
//
// The loop only means something if it CLOSES. An improvement recorded as "done" with no verification
// is a task that was ticked, so verification requires the control that originally failed to be
// passing — the same control, not a new one somebody wrote to pass.
const IMPROVEMENT_STAGES = ['observed', 'root-caused', 'action-agreed', 'decided', 'verified', 'outcome-recorded'];

class ImprovementLoop {
  constructor({ clock = () => 0 } = {}) { this._clock = clock; this._items = new Map(); this._seq = 0; }

  // A loop starts from a control that actually failed. It cannot be opened speculatively: an
  // improvement with no observed failure behind it is a project, not a correction.
  observe({ control, detail, observedBy, at = null } = {}) {
    if (!control) throw new Error('an improvement starts from the control that failed');
    if (!detail) throw new Error('an improvement must record what was observed');
    if (!observedBy) { const e = new Error('an observed failure must name who or what observed it'); e.failClosed = true; throw e; }
    const id = `IMP-${String(++this._seq).padStart(4, '0')}`;
    const item = { id, control, detail, observedBy, at: at ?? this._clock(), stage: 'observed', history: [{ stage: 'observed', by: observedBy, at: at ?? this._clock(), detail }] };
    this._items.set(id, item);
    return { ...item };
  }

  advance(id, stage, { by, detail, adr = null, at = null, controls = [] } = {}) {
    const item = this._items.get(id);
    if (!item) throw new Error('unknown improvement: ' + id);
    const index = IMPROVEMENT_STAGES.indexOf(stage);
    if (index < 0) throw new Error(`unknown improvement stage '${stage}' — one of ${IMPROVEMENT_STAGES.join(', ')}`);
    if (index !== IMPROVEMENT_STAGES.indexOf(item.stage) + 1) {
      const e = new Error(`'${item.stage}' → '${stage}' skips a stage — the loop only means something if every step happens`);
      e.failClosed = true; throw e;
    }
    if (!by || !detail) { const e = new Error('every improvement step requires a named human and what they did'); e.failClosed = true; throw e; }
    if (stage === 'decided' && !adr) { const e = new Error('a corrective action that changes the architecture requires an ADR — otherwise the fix is a change nobody decided'); e.failClosed = true; throw e; }
    if (stage === 'verified') {
      // THE RULE THAT MAKES THE LOOP CLOSE: the control that failed must now be passing. Not a new
      // control, not a report saying it was fixed — the same identifier, holding.
      const found = controls.find((c) => (typeof c === 'string' ? c : c.id) === item.control);
      const passing = found && typeof found === 'object' ? found.pass === true : false;
      if (!passing) {
        const e = new Error(`'${item.control}' is not passing, so this improvement is not verified — a fix verified by anything other than the control that failed is a fix nobody checked`);
        e.failClosed = true; throw e;
      }
    }
    item.stage = stage;
    item.history.push({ stage, by, at: at ?? this._clock(), detail, adr });
    if (adr) item.adr = adr;
    return { ...item };
  }

  items() { return [...this._items.values()].map((i) => ({ ...i })); }

  history({ now = null } = {}) {
    const rows = this.items().map((i) => ({
      id: i.id, control: i.control, stage: i.stage, adr: i.adr || null,
      closed: i.stage === 'outcome-recorded',
      // An improvement stuck before verification is the one worth naming: the work was done and
      // nobody confirmed it worked.
      stalledAt: i.stage === 'outcome-recorded' ? null : i.stage,
      steps: i.history.length, openedAt: i.at,
      durationMs: i.history.length > 1 ? i.history[i.history.length - 1].at - i.at : null,
    }));
    const closed = rows.filter((r) => r.closed);
    return {
      improvements: rows, count: rows.length,
      stages: [...IMPROVEMENT_STAGES],
      closed: closed.length, open: rows.length - closed.length,
      closureRate: rows.length ? +(closed.length / rows.length).toFixed(4) : null,
      stalled: rows.filter((r) => !r.closed).map((r) => ({ id: r.id, at: r.stalledAt })),
      meanClosureMs: closed.length ? Math.round(closed.reduce((a, r) => a + (r.durationMs || 0), 0) / closed.length) : null,
      now, informationalOnly: true, authorizes: false,
      note: 'An improvement is verified only when the control that originally failed is passing. A fix verified by a new control somebody wrote to pass is a fix nobody checked.',
    };
  }
}

// --- Part 15: the executive dashboard ------------------------------------------------------------
//
// Every panel is derived. There is no path here that accepts a figure.
function executiveGovernanceIntelligence(sources = {}) {
  const panel = (id, value, sound, detail) => ({
    panel: id, ...EXECUTIVE_PANELS[id],
    measured: value !== null && value !== undefined,
    value: value ?? null, sound: value === null || value === undefined ? null : sound,
    detail, derived: true, manualEntry: false,
  });
  const g = (fn, fallback = null) => { try { const r = fn(); return r === undefined ? fallback : r; } catch (_) { return fallback; } };

  const panels = [
    panel('institutionalResilience', g(() => sources.resilience && sources.resilience.holds), g(() => sources.resilience && sources.resilience.holds) === true, g(() => sources.resilience && `${sources.resilience.violationCount} capability(ies) depend on a single thing`, 'not assessed')),
    panel('governanceMaturity', g(() => sources.governanceMaturity && sources.governanceMaturity.level), g(() => sources.governanceMaturity && sources.governanceMaturity.level >= 4), g(() => sources.governanceMaturity && sources.governanceMaturity.name, 'not assessed')),
    panel('operationalReadiness', g(() => sources.readiness && sources.readiness.readyCount), g(() => sources.readiness && sources.readiness.allDimensionsReady), g(() => sources.readiness && `${sources.readiness.readyCount}/${sources.readiness.dimensionCount} dimensions ready`, 'not assessed')),
    panel('missionReadiness', g(() => sources.mission && sources.mission.safeToDeploy), g(() => sources.mission && sources.mission.safeToDeploy === true), g(() => sources.mission && sources.mission.boardSummary, 'not assessed')),
    panel('documentationHealth', g(() => sources.documentation && sources.documentation.verification.claims), g(() => sources.documentation && sources.documentation.sound), g(() => sources.documentation && `${sources.documentation.verification.unresolvedCount} unresolved claim(s)`, 'not assessed')),
    panel('organizationalContinuity', g(() => sources.continuity && sources.continuity.minimumBusFactor), g(() => sources.continuity && sources.continuity.sound), g(() => sources.continuity && `${sources.continuity.singlePersonDependencies.length} role(s) rest on one person`, 'not assessed')),
    panel('complianceEvolution', g(() => sources.compliance && sources.compliance.complianceRate), g(() => sources.compliance && sources.compliance.reconciliation && sources.compliance.reconciliation.sound), g(() => sources.compliance && `direction ${sources.compliance.direction}, recently ${sources.compliance.recentDirection}`, 'not assessed')),
    panel('knowledgeContinuity', g(() => sources.training && sources.training.readinessContribution), g(() => sources.training && sources.training.sound), g(() => sources.training && `${sources.training.expiredQualifications.length} expired qualification(s)`, 'not assessed')),
    panel('simulationConfidence', g(() => sources.simulation && sources.simulation.confidence), g(() => sources.simulation && ['high', 'moderate'].includes(sources.simulation.confidence)), g(() => sources.simulation && `${sources.simulation.uncalibrated.length} scenario(s) never compared against reality`, 'not assessed')),
    panel('assumptionHealth', g(() => sources.assumptions && sources.assumptions.count), g(() => sources.assumptions && sources.assumptions.sound), g(() => sources.assumptions && `${sources.assumptions.stale.length} stale, ${sources.assumptions.overclaims.length} overclaimed`, 'not assessed')),
  ];
  const unmeasured = panels.filter((p) => !p.measured).map((p) => p.panel);
  const unsound = panels.filter((p) => p.sound === false).map((p) => p.panel);
  return {
    panels, count: panels.length,
    unmeasured, unsound,
    // Weakest link: the board's picture is as good as its worst panel, and an unmeasured panel is
    // worse than a red one because it looks like nothing.
    sound: unmeasured.length === 0 && unsound.length === 0,
    everyMetricDerived: panels.every((p) => p.derived && p.manualEntry === false),
    authorizationStatus: 'NOT AUTHORIZED',
    derivedFromEvidence: true, authorizes: false, informationalOnly: true,
    note: 'Every panel is a function of a register; there is no parameter anywhere in this module that accepts a figure. An unmeasured panel is reported as unmeasured, never as satisfied.',
  };
}

// --- Part 20: the institutional assurance framework ----------------------------------------------
function institutionalAssurance(sources = {}) {
  const verdicts = {
    architecture: sources.drift ? sources.drift.clean : null,
    security: sources.security !== undefined ? sources.security : null,
    privacy: sources.privacy !== undefined ? sources.privacy : null,
    governance: sources.governanceMaturity ? sources.governanceMaturity.level >= 3 : null,
    documentation: sources.documentation ? sources.documentation.sound : null,
    operationalReadiness: sources.readiness ? sources.readiness.allDimensionsReady : null,
    organizationalReadiness: sources.continuity ? sources.continuity.sound : null,
    institutionalResilience: sources.resilience ? sources.resilience.holds : null,
    training: sources.training ? sources.training.sound : null,
    knowledgeContinuity: sources.continuity ? sources.continuity.minimumBusFactor >= 2 : null,
    compliance: sources.compliance && sources.compliance.reconciliation ? sources.compliance.reconciliation.sound : null,
    missionReadiness: sources.mission ? sources.mission.safeToDeploy : null,
    evidenceQuality: sources.evidenceQuality ? sources.evidenceQuality.sound : null,
  };
  const domains = Object.keys(ASSURANCE_DOMAINS).map((id) => ({
    domain: id,
    ...ASSURANCE_DOMAINS[id],
    verified: verdicts[id] === true,
    // Unmeasured is its own state, and the framework says what it would mean rather than hiding it.
    state: verdicts[id] === true ? 'verified' : verdicts[id] === false ? 'failing' : 'unmeasured',
  }));
  const unmeasured = domains.filter((d) => d.state === 'unmeasured');
  const failing = domains.filter((d) => d.state === 'failing');
  return {
    domains, count: domains.length,
    verified: domains.filter((d) => d.verified).length,
    failing: failing.map((d) => d.domain),
    unmeasured: unmeasured.map((d) => d.domain),
    // Institutional readiness is the weakest domain, and an unmeasured domain is not a green one.
    institutionallyReady: failing.length === 0 && unmeasured.length === 0,
    blockers: [
      ...failing.map((d) => `${d.domain}: failing — ${d.unverifiedMeans}`),
      ...unmeasured.map((d) => `${d.domain}: unmeasured — ${d.unverifiedMeans}`),
    ],
    // THE INVARIANT THAT SURVIVES EVERY PHASE. A constant string; nothing computes it.
    authorizationStatus: 'NOT AUTHORIZED',
    authorizationBasis: 'Authorization is a recorded decision by the approving authority for a specific deployment. Thirteen verified domains do not produce one, and no aggregate of evidence ever will.',
    derivedFromReadiness: false, authorizes: false, failClosed: true,
    note: 'The framework proves institutional readiness. It does not replace human authority, and an unmeasured domain is reported as unmeasured rather than as satisfied — a framework that renders "nobody looked" as a green tick is worse than none, because it is trusted.',
  };
}

module.exports = {
  EXECUTIVE_PANELS, ASSURANCE_DOMAINS, IMPROVEMENT_STAGES,
  ImprovementLoop, executiveGovernanceIntelligence, institutionalAssurance,
};
