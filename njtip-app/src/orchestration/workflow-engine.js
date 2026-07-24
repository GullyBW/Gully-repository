'use strict';
// Workflow Orchestration Platform (Phase 20). Workflows are DATA (definitions), so business
// users configure processes WITHOUT code changes: states, event-driven routing, declarative
// rule GUARDS, APPROVAL CHAINS, SLA + ESCALATION, and VERSIONING. Deterministic; the engine
// only routes — it never performs side effects. This complements the fixed case-lifecycle;
// it does not replace it.
const { OPS } = require('../iam/policy-engine');

// A definition: { id, version, start, terminal:[..], states: { name: {
//   on: { event: targetState }, guard?: [{attr,op,value}], approvals?: [roles],
//   slaMs?, escalateTo? } } }
function validateDef(def) {
  if (!def.id || !def.version || !def.start || !def.states) throw new Error('invalid workflow definition');
  if (!def.states[def.start]) throw new Error('start state not in states');
  return def;
}

class WorkflowEngine {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._defs = new Map(); this._latest = new Map(); this._instances = new Map(); this._seq = 0; }

  register(def) { validateDef(def); this._defs.set(`${def.id}@${def.version}`, def); const cur = this._latest.get(def.id); if (!cur || def.version > cur) this._latest.set(def.id, def.version); return def; }
  _def(id, version) { return this._defs.get(`${id}@${version ?? this._latest.get(id)}`) || null; }

  // Start an instance, PINNED to a definition version (running instances are stable across
  // later definition changes — workflow versioning).
  start(defId, { context = {}, version } = {}) {
    const def = this._def(defId, version); if (!def) throw new Error('unknown workflow: ' + defId);
    const id = 'WF-' + (++this._seq).toString().padStart(5, '0');
    const inst = { id, defId, version: def.version, state: def.start, context, enteredAt: this._clock(), approvals: {}, history: [{ state: def.start, at: this._clock() }] };
    this._instances.set(id, inst);
    return this._view(inst);
  }

  // Record an approval toward the current state's approval chain (one per role).
  approve(instanceId, { role, by }) {
    const inst = this._must(instanceId); const st = this._def(inst.defId, inst.version).states[inst.state];
    if (!st.approvals || !st.approvals.includes(role)) throw new Error(`role '${role}' is not an approver for state '${inst.state}'`);
    if (!by) throw new Error('an accountable approver is required');
    inst.approvals[inst.state] = inst.approvals[inst.state] || {};
    inst.approvals[inst.state][role] = { by, at: this._clock() };
    return { instanceId, state: inst.state, collected: Object.keys(inst.approvals[inst.state]), required: st.approvals };
  }

  // Fire an event → route per the definition, enforcing guards + approval chains.
  fire(instanceId, event, { by } = {}) {
    const inst = this._must(instanceId); const def = this._def(inst.defId, inst.version); const st = def.states[inst.state];
    const target = st.on && st.on[event]; if (!target) throw new Error(`illegal event '${event}' in state '${inst.state}'`);
    // Rule guard (declarative conditions over the instance context).
    for (const c of st.guard || []) { const fn = OPS[c.op]; if (!fn || !fn(get(inst.context, c.attr), c.value)) throw new Error(`guard failed: ${c.attr} ${c.op} ${JSON.stringify(c.value)}`); }
    // Approval chain: all required roles must have approved to leave this state.
    if (st.approvals && st.approvals.length) {
      const got = Object.keys(inst.approvals[inst.state] || {});
      const missing = st.approvals.filter((r) => !got.includes(r));
      if (missing.length) throw new Error(`pending approvals: ${missing.join(', ')}`);
    }
    inst.state = target; inst.enteredAt = this._clock(); inst.history.push({ state: target, at: inst.enteredAt, via: event, by: by || 'system' });
    return this._view(inst);
  }

  // SLA + escalation: if the current state has an SLA and it is breached, route to escalateTo.
  slaStatus(instanceId) {
    const inst = this._must(instanceId); const st = this._def(inst.defId, inst.version).states[inst.state];
    if (!st.slaMs) return { state: inst.state, sla: false };
    const breached = this._clock() - inst.enteredAt > st.slaMs;
    return { state: inst.state, sla: true, breached, dueAt: inst.enteredAt + st.slaMs, escalateTo: st.escalateTo || null };
  }
  escalate(instanceId) {
    const inst = this._must(instanceId); const st = this._def(inst.defId, inst.version).states[inst.state];
    const s = this.slaStatus(instanceId);
    if (!s.breached || !st.escalateTo) throw new Error('no SLA breach / no escalation target');
    inst.state = st.escalateTo; inst.enteredAt = this._clock(); inst.history.push({ state: st.escalateTo, at: inst.enteredAt, via: 'escalation' });
    return this._view(inst);
  }

  isTerminal(instanceId) { const inst = this._must(instanceId); return (this._def(inst.defId, inst.version).terminal || []).includes(inst.state); }
  instance(instanceId) { return this._view(this._must(instanceId)); }
  analytics() { const byState = {}; for (const i of this._instances.values()) byState[i.state] = (byState[i.state] || 0) + 1; return { instances: this._instances.size, byState }; }

  _must(id) { const i = this._instances.get(id); if (!i) throw new Error('unknown instance: ' + id); return i; }
  _view(i) { return { id: i.id, defId: i.defId, version: i.version, state: i.state, history: i.history.map((h) => ({ ...h })) }; }
}
function get(obj, path) { return String(path).split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }

// A default, reviewable investigation workflow definition (data — editable without code).
const DEFAULT_WORKFLOW = {
  id: 'investigation', version: 1, start: 'intake', terminal: ['closed'],
  states: {
    intake: { on: { assess: 'assessment' } },
    assessment: { on: { investigate: 'investigation', dismiss: 'closed' }, slaMs: 3 * 24 * 3600_000, escalateTo: 'investigation' },
    investigation: { on: { review: 'oversight' } },
    oversight: { on: { decide: 'decision' }, approvals: ['oversight-board'] },
    decision: { on: { close: 'closed' } },
    closed: { on: {} },
  },
};

module.exports = { WorkflowEngine, DEFAULT_WORKFLOW, validateDef };
