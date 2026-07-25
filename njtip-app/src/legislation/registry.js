'use strict';
// Digital Legislation & Regulatory Governance (Phase 53). Governs laws, regulations, and
// public policy as versioned, traceable artifacts: a legislative/regulation registry, legal
// version management + change tracking, impact analysis, a regulatory dependency graph,
// policy-to-system mapping, regulatory SIMULATION, audit trails, compatibility validation,
// and compliance traceability. Deterministic. Every legal change is SIMULATABLE before
// implementation. Changes are advisory records — enactment remains a human decision.
class LegislativeRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._instruments = new Map(); this._systemMap = new Map(); this._audit = []; }

  // Register a legal instrument (act/regulation) — starts as 'draft'.
  register(id, { title, type = 'regulation', dependsOn = [], mapsToControls = [], mapsToSystems = [] } = {}) {
    if (!id || !title) throw new Error('legal instrument id and title are required');
    if (this._instruments.has(id)) throw new Error('instrument already registered (use amend)');
    this._instruments.set(id, { id, title, type, status: 'draft', versions: [{ version: 1, at: this._clock(), summary: 'initial' }], dependsOn: [...dependsOn], mapsToControls: [...mapsToControls], mapsToSystems: [...mapsToSystems] });
    this._log('registered', id);
    return this.describe(id);
  }
  // Amend (version) an instrument with a change summary (legal change tracking).
  amend(id, { summary, mapsToControls, mapsToSystems } = {}) {
    const i = this._must(id); const version = i.versions.length + 1;
    i.versions.push({ version, at: this._clock(), summary: summary || 'amendment' });
    if (mapsToControls) i.mapsToControls = [...mapsToControls];
    if (mapsToSystems) i.mapsToSystems = [...mapsToSystems];
    this._log('amended', id);
    return { id, version };
  }
  enact(id, { by } = {}) { const i = this._must(id); if (!by) throw new Error('enactment requires a named human authority'); i.status = 'in-force'; i.enactedBy = by; this._log('enacted', id, by); return this.describe(id); }
  repeal(id, { by } = {}) { const i = this._must(id); i.status = 'repealed'; this._log('repealed', id, by || 'system'); return this.describe(id); }

  describe(id) { const i = this._must(id); return { id: i.id, title: i.title, type: i.type, status: i.status, version: i.versions.length, dependsOn: [...i.dependsOn], mapsToControls: [...i.mapsToControls], mapsToSystems: [...i.mapsToSystems] }; }
  history(id) { return this._must(id).versions.map((v) => ({ ...v })); }
  registryList() { return [...this._instruments.keys()].map((id) => this.describe(id)); }

  // Regulatory dependency graph (instrument → instruments it depends on).
  dependencyGraph() { const g = {}; for (const i of this._instruments.values()) g[i.id] = [...i.dependsOn]; return g; }

  // Impact analysis: which OTHER instruments + systems + controls a change to `id` touches.
  impact(id) {
    this._must(id);
    const dependents = [...this._instruments.values()].filter((x) => x.dependsOn.includes(id)).map((x) => x.id);
    const i = this._instruments.get(id);
    return { instrument: id, affectedInstruments: dependents, affectedSystems: [...i.mapsToSystems], affectedControls: [...i.mapsToControls], note: 'Advisory impact analysis; enactment is a human decision.' };
  }

  // Regulatory simulation: model a proposed amendment BEFORE implementation. Returns the
  // impact + a compatibility verdict (removing a control mapping is a compatibility risk).
  simulate(id, { proposedControls = null, proposedSystems = null } = {}) {
    const i = this._must(id);
    const impact = this.impact(id);
    const removedControls = proposedControls ? i.mapsToControls.filter((c) => !proposedControls.includes(c)) : [];
    const removedSystems = proposedSystems ? i.mapsToSystems.filter((s) => !proposedSystems.includes(s)) : [];
    return { instrument: id, impact, compatibility: { removedControls, removedSystems, breaking: removedControls.length > 0 || removedSystems.length > 0 }, simulatable: true, note: 'Every legal change is simulatable before implementation. Advisory only.' };
  }

  // Compliance traceability: from a compliance control id → the instruments that mandate it.
  traceControl(controlId) { return [...this._instruments.values()].filter((i) => i.mapsToControls.includes(controlId)).map((i) => i.id); }
  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, id, actor) { this._audit.push({ at: this._clock(), event, instrument: id, actor: actor || 'system' }); }
  _must(id) { const i = this._instruments.get(id); if (!i) throw new Error('unknown legal instrument: ' + id); return i; }
}

module.exports = { LegislativeRegistry };
