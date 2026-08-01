'use strict';
// Structured Usability Validation (Stabilization Part 15). Future refinement should be driven by
// implementation experience and observed user behaviour, not architectural speculation. This
// module records that evidence in a form the platform can act on: representative user roles,
// the real workflows they perform, observed sessions, and derived findings traced to the
// capability that must change.
//
// Participants are ROLE-CODED (P-INV-01). No participant name, contact detail or any other
// identifying field may be recorded — the module refuses them, exactly as the domain does.
// Deterministic: findings are a pure function of the recorded sessions.
const PARTICIPANT_ID = /^P-[A-Z]{2,4}-\d{2}$/;
const IDENTITY_FIELDS = new Set(['name', 'email', 'phone', 'omang', 'nationalid', 'address', 'dob', 'participantname', 'contact']);

// Representative user roles engaged in validation.
const PERSONAS = {
  investigator: { role: 'Investigator', context: 'investigation', goal: 'Work a case from queue to disposition without ever seeing a reporter identity.' },
  auditor: { role: 'Auditor', context: 'assurance', goal: 'Independently verify that what the platform claims happened, happened.' },
  administrator: { role: 'Platform administrator', context: 'composition', goal: 'Operate the platform safely: configuration, health, keys, readiness.' },
  'governance-official': { role: 'Governance official', context: 'governance-oversight', goal: 'Record a defensible decision with the evidence attached to it.' },
  'oversight-board': { role: 'Oversight board member', context: 'governance-oversight', goal: 'See system-wide posture without seeing any individual case subject.' },
  'operational-staff': { role: 'Operational staff', context: 'observability', goal: 'Detect, triage and recover from an incident within the objectives.' },
};

// The task scenarios observed, each traced to the workflow it exercises.
const TASKS = {
  'triage-queue': { persona: 'investigator', goal: 'Find the highest-priority case awaiting review and open it.', steps: ['GET /api/reports', 'GET /api/reports/{code}/timeline'], successCriterion: 'Opens the correct case without consulting a colleague.' },
  'complete-review': { persona: 'investigator', goal: 'Review a case and record a disposition.', steps: ['POST /api/investigator/{code}/review', 'POST /api/investigator/{code}/transition'], successCriterion: 'Disposition recorded and the lifecycle advances legally.' },
  'attach-evidence': { persona: 'investigator', goal: 'Attach evidence and confirm the chain of custody is intact.', steps: ['POST /api/reports/{code}/evidence'], successCriterion: 'Custody chain verifies after attachment.' },
  'verify-evidence-package': { persona: 'auditor', goal: 'Independently verify the signed assurance evidence package.', steps: ['GET /api/assurance/evidence-package', 'GET /api/twin/validate'], successCriterion: 'Reproduces the digest and confirms every invariant.' },
  'trace-decision': { persona: 'auditor', goal: 'Trace a governance decision back to the evidence behind it.', steps: ['GET /api/governance/decisions', 'GET /api/reports/{code}/events'], successCriterion: 'Reaches the originating events without an engineer.' },
  'check-readiness': { persona: 'administrator', goal: 'Assess operational readiness before a change window.', steps: ['GET /api/assurance/readiness', 'GET /api/admin/infra-assurance'], successCriterion: 'Understands that readiness informs but never authorizes.' },
  'rotate-configuration': { persona: 'administrator', goal: 'Change a configuration value safely and confirm the effect.', steps: ['GET /api/admin/config', 'GET /api/admin/health'], successCriterion: 'No secret is exposed and health stays green.' },
  'record-decision': { persona: 'governance-official', goal: 'Record a governance decision with a rationale.', steps: ['POST /api/governance/decisions'], successCriterion: 'Decision recorded, hash-chained and attributable to the named human.' },
  'review-posture': { persona: 'oversight-board', goal: 'Review national posture without seeing individual case content.', steps: ['GET /api/oversight/dashboard', 'GET /api/process/governance'], successCriterion: 'Answers the oversight question from aggregates alone.' },
  'triage-incident': { persona: 'operational-staff', goal: 'Triage an SLO breach and choose a recovery strategy to propose.', steps: ['GET /api/admin/slo', 'POST /api/recovery/strategies/evaluate'], successCriterion: 'Reaches a proposal that a named authority can authorize.' },
};

class UsabilityValidation {
  constructor() { this._sessions = []; }

  personas() { return Object.entries(PERSONAS).map(([id, p]) => ({ id, ...p })); }
  tasks() { return Object.entries(TASKS).map(([id, t]) => ({ id, ...t })); }

  // Record an observed session. Refuses any identifying field about the participant.
  recordSession({ participant, taskId, completed, secondsToComplete = null, assists = 0, observations = [], ...rest } = {}) {
    const leaked = Object.keys(rest).filter((k) => IDENTITY_FIELDS.has(k.toLowerCase()));
    if (leaked.length) { const e = new Error(`usability sessions refuse participant identity: ${leaked.join(', ')}`); e.failClosed = true; throw e; }
    if (!PARTICIPANT_ID.test(String(participant || ''))) { const e = new Error('participant must be a role-coded id such as P-INV-01'); e.failClosed = true; throw e; }
    const task = TASKS[taskId];
    if (!task) throw new Error('unknown task: ' + taskId);
    if (typeof completed !== 'boolean') throw new Error('completed (boolean) is required');
    const session = { participant, taskId, persona: task.persona, completed, secondsToComplete, assists, observations: [...observations] };
    this._sessions.push(session);
    return { ...session };
  }
  sessions() { return this._sessions.map((s) => ({ ...s })); }

  // Per-task outcomes across all observed sessions (deterministic aggregation).
  taskOutcomes() {
    const out = {};
    for (const [id, t] of Object.entries(TASKS)) {
      const rows = this._sessions.filter((s) => s.taskId === id);
      const completed = rows.filter((s) => s.completed).length;
      const times = rows.filter((s) => typeof s.secondsToComplete === 'number').map((s) => s.secondsToComplete);
      out[id] = {
        task: id, persona: t.persona, goal: t.goal, observed: rows.length, completed,
        completionRate: rows.length ? +(completed / rows.length).toFixed(2) : null,
        assists: rows.reduce((a, s) => a + s.assists, 0),
        medianSeconds: times.length ? times.slice().sort((a, b) => a - b)[Math.floor(times.length / 2)] : null,
        observations: rows.flatMap((s) => s.observations),
      };
    }
    return out;
  }

  // Findings derived from observed behaviour — each traced to the persona, the task and the
  // bounded context that would have to change. No finding is invented; every one cites its rate.
  findings() {
    const out = [];
    for (const o of Object.values(this.taskOutcomes())) {
      if (!o.observed) { out.push({ task: o.task, persona: o.persona, severity: 'info', finding: 'not yet observed with users', context: PERSONAS[o.persona].context, evidence: 'no sessions recorded' }); continue; }
      if (o.completionRate === 0) out.push({ task: o.task, persona: o.persona, severity: 'blocker', finding: 'no participant completed this task', context: PERSONAS[o.persona].context, evidence: `0/${o.observed} completed` });
      else if (o.completionRate < 0.7) out.push({ task: o.task, persona: o.persona, severity: 'high', finding: 'most participants could not complete this task unaided', context: PERSONAS[o.persona].context, evidence: `${o.completed}/${o.observed} completed` });
      else if (o.assists > 0) out.push({ task: o.task, persona: o.persona, severity: 'medium', finding: 'task completed only with assistance', context: PERSONAS[o.persona].context, evidence: `${o.assists} assist(s) across ${o.observed} session(s)` });
      for (const obs of o.observations) out.push({ task: o.task, persona: o.persona, severity: 'low', finding: obs, context: PERSONAS[o.persona].context, evidence: 'participant observation' });
    }
    const rank = { blocker: 0, high: 1, medium: 2, low: 3, info: 4 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || a.task.localeCompare(b.task));
  }

  // Coverage: every persona must have been observed on at least one task.
  coverage() {
    const byPersona = {};
    for (const [id, p] of Object.entries(PERSONAS)) {
      const rows = this._sessions.filter((s) => s.persona === id);
      byPersona[id] = { persona: id, role: p.role, sessions: rows.length, tasksObserved: [...new Set(rows.map((s) => s.taskId))].sort(), covered: rows.length > 0 };
    }
    const uncovered = Object.values(byPersona).filter((p) => !p.covered).map((p) => p.persona);
    return { byPersona, uncovered, complete: uncovered.length === 0 };
  }

  report() {
    const findings = this.findings();
    return {
      personas: this.personas(), tasks: this.tasks(),
      sessions: this._sessions.length, outcomes: this.taskOutcomes(),
      findings, blockers: findings.filter((f) => f.severity === 'blocker'),
      coverage: this.coverage(),
      note: 'Observed-behaviour evidence. Findings prioritise refinement; they do not authorize a design change — that remains a human product decision.',
    };
  }
}

// A deterministic set of observed sessions from the first validation round. Synthetic
// observations standing in for a real round; the SHAPE is what production will populate.
function seedRound(uv = new UsabilityValidation()) {
  const s = (participant, taskId, completed, secondsToComplete, assists, observations = []) => uv.recordSession({ participant, taskId, completed, secondsToComplete, assists, observations });
  s('P-INV-01', 'triage-queue', true, 45, 0);
  s('P-INV-02', 'triage-queue', true, 62, 1, ['expected priority to be shown in the queue, not on the case']);
  s('P-INV-01', 'complete-review', true, 120, 0);
  s('P-INV-02', 'complete-review', true, 180, 1, ['unclear which lifecycle transitions are legal from the current state']);
  s('P-INV-03', 'attach-evidence', true, 90, 0);
  s('P-AUD-01', 'verify-evidence-package', true, 240, 0, ['wanted the digest recomputation shown alongside the signature']);
  s('P-AUD-02', 'trace-decision', false, null, 2, ['could not get from a decision back to its originating events unaided']);
  s('P-ADM-01', 'check-readiness', true, 75, 0, ['read the readiness score as an approval until the wording was pointed out']);
  s('P-ADM-01', 'rotate-configuration', true, 55, 0);
  s('P-GOV-01', 'record-decision', true, 95, 0);
  s('P-OB-01', 'review-posture', true, 140, 1, ['wanted the aggregate suppression rule stated on the dashboard itself']);
  s('P-OPS-01', 'triage-incident', true, 210, 1, ['strategy comparison was clear; the authorization step was not discoverable']);
  return uv;
}

module.exports = { UsabilityValidation, PERSONAS, TASKS, seedRound };
