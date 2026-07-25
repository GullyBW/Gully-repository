'use strict';
// Human-Governed Autonomous Recovery (Phase 54). Extends resilience engineering: a recovery
// PLAYBOOK registry, a recovery workflow that RECOMMENDS actions, recovery SIMULATION,
// infrastructure recovery validation, incident recovery plans, an approval workflow, and
// audit trails. The platform MAY RECOMMEND recovery actions; it MUST NEVER execute recovery
// without explicit human authorization (fail-closed). Deterministic.
const { validateResilience } = require('./resilience-validation');

class RecoveryPlatform {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._playbooks = new Map(); this._plans = new Map(); this._audit = []; this._seq = 0; }

  // Register a recovery playbook: an incident type → ordered recovery steps.
  registerPlaybook(id, { incidentType, steps = [] } = {}) {
    if (!id || !incidentType || !steps.length) throw new Error('playbook id, incidentType, and steps are required');
    this._playbooks.set(id, { id, incidentType, steps: [...steps] });
    return { id, incidentType, steps: steps.length };
  }
  playbooks() { return [...this._playbooks.values()].map((p) => ({ id: p.id, incidentType: p.incidentType, steps: [...p.steps] })); }

  // Recommend a recovery plan for an incident (ADVISORY — never executes).
  recommend({ incidentType, context = {} }) {
    const pb = [...this._playbooks.values()].find((p) => p.incidentType === incidentType);
    if (!pb) return { incidentType, plan: null, note: 'no matching playbook — human triage required' };
    const id = 'REC-' + (++this._seq).toString().padStart(4, '0');
    const plan = { id, incidentType, playbook: pb.id, steps: [...pb.steps], context, status: 'recommended', authorizedBy: null, executed: false };
    this._plans.set(id, plan);
    this._log('recommended', id);
    return { id, incidentType, steps: [...pb.steps], status: 'recommended', advisoryOnly: true, requiresHumanAuthorization: true, note: 'Recommendation only — recovery is never executed without explicit human authorization.' };
  }

  // Simulate a recovery plan (deterministic) — validates the target resilience scenario holds.
  simulate(planId, { scenarioSuite } = {}) {
    const plan = this._must(planId);
    const validation = validateResilience(scenarioSuite);
    return { planId, steps: plan.steps, projectedResilience: validation.pass, note: 'Simulated outcome; advisory. Execution still requires human authorization.' };
  }

  // Recovery approval workflow: a NAMED human authorizes the plan (separation from requester).
  authorize(planId, { by, rationale } = {}) {
    const plan = this._must(planId);
    if (!by || !rationale) throw new Error('recovery authorization requires a named human and a rationale');
    plan.status = 'authorized'; plan.authorizedBy = by; this._log('authorized', planId, by);
    return { planId, status: 'authorized', authorizedBy: by };
  }

  // "Execute" — permitted ONLY after human authorization. In this synthetic reference it
  // records that authorized steps would run; it performs NO real infrastructure change.
  execute(planId) {
    const plan = this._must(planId);
    if (plan.status !== 'authorized') { const e = new Error('recovery execution refused — no human authorization'); e.failClosed = true; throw e; }
    plan.executed = true; plan.status = 'executed'; this._log('executed', planId, plan.authorizedBy);
    return { planId, executed: true, executedSteps: plan.steps, note: 'Synthetic execution record — no production change performed. Authorized by ' + plan.authorizedBy };
  }

  plan(planId) { const p = this._plans.get(planId); return p ? { ...p } : null; }
  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, planId, actor) { this._audit.push({ at: this._clock(), event, plan: planId, actor: actor || 'system' }); }
  _must(planId) { const p = this._plans.get(planId); if (!p) throw new Error('unknown recovery plan: ' + planId); return p; }
}

// A default set of reviewed recovery playbooks.
function seedPlaybooks(rp) {
  rp.registerPlaybook('pb-region-outage', { incidentType: 'regional-outage', steps: ['drain failed region', 'shift traffic to healthy regions', 'verify quorum', 'notify ops'] });
  rp.registerPlaybook('pb-cyber', { incidentType: 'cyber-incident', steps: ['isolate affected zone', 'rotate credentials', 'preserve audit + custody', 'engage IR team'] });
  rp.registerPlaybook('pb-surge', { incidentType: 'surge', steps: ['scale out via HPA', 'shed non-critical load', 'monitor SLO burn'] });
  return rp;
}

module.exports = { RecoveryPlatform, seedPlaybooks };
