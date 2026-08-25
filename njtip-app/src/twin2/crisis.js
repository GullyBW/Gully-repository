'use strict';
// National Mission & Crisis Management Platform (Phase 63). Extends resilience + recovery into
// coordinated NATIONAL operations: a national incident registry, multi-agency coordination, a
// crisis workflow, emergency-playbook governance, disaster/cyber/public-health simulation,
// continuity-of-government planning, resource coordination, and mission audit trails. All
// simulations are DETERMINISTIC. Operational execution requires NAMED HUMAN AUTHORIZATION
// (fail-closed) — nothing is actioned autonomously.
const { validateResilience } = require('./resilience-validation');

const INCIDENT_TYPES = new Set(['natural-disaster', 'cyber-incident', 'public-health', 'infrastructure-failure', 'security-threat']);
const SEVERITIES = ['low', 'moderate', 'severe', 'catastrophic'];
const STAGES = ['declared', 'coordinating', 'contained', 'recovered', 'closed'];

class NationalCrisisPlatform {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._incidents = new Map(); this._audit = []; this._seq = 0; }

  // Declare a national incident (starts 'declared').
  declare({ type, severity = 'moderate', affectedAgencies = [] }) {
    if (!INCIDENT_TYPES.has(type)) throw new Error('unknown incident type: ' + type);
    if (!SEVERITIES.includes(severity)) throw new Error('invalid severity');
    const id = 'INC-' + (++this._seq).toString().padStart(4, '0');
    this._incidents.set(id, { id, type, severity, stage: 'declared', affectedAgencies: [...affectedAgencies], coordination: [], resources: [], authorized: false, at: this._clock() });
    this._log('declared', id);
    return this.describe(id);
  }
  describe(id) { const i = this._must(id); return { id: i.id, type: i.type, severity: i.severity, stage: i.stage, affectedAgencies: [...i.affectedAgencies], authorized: i.authorized }; }
  incidents() { return [...this._incidents.keys()].map((id) => this.describe(id)); }

  // Multi-agency coordination: assign an agency a role in the response.
  assignAgency(id, { agency, role }) { const i = this._must(id); if (!agency || !role) throw new Error('agency and role required'); i.coordination.push({ agency, role }); if (!i.affectedAgencies.includes(agency)) i.affectedAgencies.push(agency); this._log('agency-assigned:' + agency, id); return { id, coordination: [...i.coordination] }; }
  // Resource coordination: allocate a (synthetic) resource to the incident.
  allocateResource(id, { resource, quantity }) { const i = this._must(id); i.resources.push({ resource, quantity, at: this._clock() }); this._log('resource-allocated:' + resource, id); return { id, resources: [...i.resources] }; }

  // Advance the crisis stage (coordinating → contained → recovered → closed).
  advance(id) { const i = this._must(id); const idx = STAGES.indexOf(i.stage); if (idx === STAGES.length - 1) throw new Error('incident already closed'); i.stage = STAGES[idx + 1]; this._log('advanced:' + i.stage, id); return this.describe(id); }

  // Disaster / cyber / public-health SIMULATION — deterministic; validates that the response
  // scenario survives the platform's resilience checks. Advisory; never executes.
  simulate(id, { scenarioSuite } = {}) {
    const i = this._must(id);
    const validation = validateResilience(scenarioSuite);
    return { incident: id, type: i.type, severity: i.severity, projectedResilience: validation.pass, scenarios: validation.results.map((r) => ({ scenario: r.scenario, pass: r.pass })), note: 'Deterministic crisis simulation; advisory. Execution requires named human authorization.' };
  }

  // Continuity-of-government plan (declarative, non-identifying) for an incident.
  continuityPlan(id) { const i = this._must(id); return { incident: id, essentialFunctions: ['intake', 'evidence-custody', 'audit', 'governance-ledger'], failoverPosture: 'multi-region active-active', delegationOfAuthority: 'pre-authorised succession (human-recorded)', note: 'Continuity plan is advisory; activation is a recorded human decision.' }; }

  // Named human AUTHORIZATION is required before any operational execution (fail-closed).
  authorizeOperation(id, { by, rationale }) { const i = this._must(id); if (!by || !rationale) throw new Error('crisis operation authorization requires a named human and a rationale'); i.authorized = true; i.authorizedBy = by; this._log('operation-authorized', id, by); return { id, authorized: true, authorizedBy: by }; }
  executeOperation(id) { const i = this._must(id); if (!i.authorized) { const e = new Error('crisis operation refused — no human authorization'); e.failClosed = true; throw e; } this._log('operation-executed', id, i.authorizedBy); return { id, executed: true, note: 'Synthetic execution record — no production action performed. Authorized by ' + i.authorizedBy }; }

  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, id, actor) { this._audit.push({ at: this._clock(), event, incident: id, actor: actor || 'system' }); }
  _must(id) { const i = this._incidents.get(id); if (!i) throw new Error('unknown incident: ' + id); return i; }
}

module.exports = { NationalCrisisPlatform, INCIDENT_TYPES, SEVERITIES, STAGES };
