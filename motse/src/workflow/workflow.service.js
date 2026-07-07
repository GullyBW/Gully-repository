'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Configurable workflow engine (Phase 3, WS4).
 *
 * Approval flows become DATA, not code. A definition is JSON:
 *   {
 *     key, description,
 *     steps: [
 *       { id, name, type: 'approval'|'action'|'timer',
 *         approvals_required?, roles?: [{role, scope_from}], any_of?,
 *         condition?: {field, op, value},   // conditional routing
 *         timeout_ms?, on_timeout?: 'escalate'|'reject'|'auto_approve',
 *         escalate_to?: {role, scope_from},
 *         action?: 'handlerName',            // bridges to a domain service
 *         parallel_group? }
 *     ]
 *   }
 *
 * Instances carry a context object; steps read it for conditions and
 * approver scoping. Every transition is audited and notified. Action
 * steps invoke registered handlers so the engine can DRIVE real domain
 * operations (milestone release, seat grant) without embedding business
 * logic — the handler is the seam.
 *
 * Backward compatibility: the existing hardcoded flows in Kgetsi,
 * Governance, Heritage etc. are untouched and remain the source of
 * truth. This engine is an OPT-IN orchestration layer; a definition can
 * mirror an existing flow and drive it through action handlers, which is
 * how administrators reconfigure approvals without code changes.
 */
const CONDITION_OPS = {
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  gt: (a, b) => a > b,
  gte: (a, b) => a >= b,
  lt: (a, b) => a < b,
  lte: (a, b) => a <= b,
  in: (a, b) => Array.isArray(b) && b.includes(a),
};

class WorkflowService {
  constructor({ store, clock, identity, audit, bus, notifications }) {
    this.definitions = store.collection('workflow_definitions');
    this.instances = store.collection('workflow_instances');
    this.clock = clock;
    this.identity = identity;
    this.audit = audit;
    this.bus = bus;
    this.notifications = notifications;
    this.handlers = new Map(); // action name -> (instance, step, ctx) => void

    bus.register('workflow.started', 1, ['instance_id', 'definition_key']);
    bus.register('workflow.step.completed', 1, ['instance_id', 'step_id']);
    bus.register('workflow.completed', 1, ['instance_id', 'outcome']);
  }

  /** Register an action handler that bridges to a domain service. */
  registerHandler(name, fn) {
    this.handlers.set(name, fn);
  }

  // ── Definition management (admin, no code changes) ─────────────────

  defineWorkflow(definition, actor) {
    if (!definition.key || !Array.isArray(definition.steps) || definition.steps.length === 0) {
      throw err('INVALID_ARGUMENT', 'A workflow needs a key and at least one step');
    }
    for (const step of definition.steps) {
      if (!step.id || !step.type) throw err('INVALID_ARGUMENT', 'Each step needs an id and type');
      if (!['approval', 'action', 'timer'].includes(step.type)) {
        throw err('INVALID_ARGUMENT', `Unknown step type ${step.type}`);
      }
      if (step.type === 'action' && !this.handlers.has(step.action) && !step.optional_handler) {
        throw err('INVALID_ARGUMENT', `No handler registered for action "${step.action}"`);
      }
    }
    const existing = this.definitions.findOne((d) => d.key === definition.key);
    const version = existing ? existing.version + 1 : 1;
    // New version supersedes; old versions are retained for running instances.
    if (existing) this.definitions.update(existing.id, { active: false });
    const record = this.definitions.insert({
      id: id('wfd'),
      key: definition.key,
      version,
      description: definition.description || null,
      steps: definition.steps,
      active: true,
      created_by: actor,
      created_at: this.clock.nowIso(),
    });
    this.audit.append(actor, 'workflow.defined', `workflow:${definition.key}`, null, { version });
    return record;
  }

  activeDefinition(key) {
    const def = this.definitions.findOne((d) => d.key === key && d.active);
    if (!def) throw err('NOT_FOUND', `No active workflow "${key}"`);
    return def;
  }

  listDefinitions() {
    return this.definitions.find((d) => d.active);
  }

  // ── Instances ──────────────────────────────────────────────────────

  start(key, { context = {}, objectRef, actor }) {
    const def = this.activeDefinition(key);
    const instance = this.instances.insert({
      id: id('wfi'),
      definition_key: key,
      definition_version: def.version,
      object_ref: objectRef || null,
      context,
      state: 'running',
      current_step_index: 0,
      step_states: def.steps.map((s) => ({
        step_id: s.id,
        state: 'pending',
        approvals: [],
        delegated: {},
        started_at: null,
      })),
      started_by: actor,
      started_at: this.clock.nowIso(),
    });
    this.audit.append(actor, 'workflow.started', instanceRef(instance), null, { key });
    this.bus.publish('workflow.started', { instance_id: instance.id, definition_key: key });
    this._enterStep(instance.id);
    return this.instances.get(instance.id);
  }

  get(instanceId) {
    const instance = this.instances.get(instanceId);
    if (!instance) throw err('NOT_FOUND', `No workflow instance ${instanceId}`);
    return instance;
  }

  /** Advance to the first non-skipped step at/after the cursor. */
  _enterStep(instanceId) {
    let instance = this.get(instanceId);
    const def = this._definitionFor(instance);
    while (instance.current_step_index < def.steps.length) {
      const step = def.steps[instance.current_step_index];
      // Conditional routing: a failed condition skips the step.
      if (step.condition && !this._evaluateCondition(step.condition, instance.context)) {
        this._markStep(instanceId, step.id, { state: 'skipped' });
        instance = this._advance(instanceId);
        continue;
      }
      this._markStep(instanceId, step.id, {
        state: 'active',
        started_at: this.clock.nowIso(),
        deadline: step.timeout_ms ? this.clock.nowMs() + step.timeout_ms : null,
      });
      if (step.type === 'action') {
        this._runAction(instanceId, step);
        instance = this.get(instanceId);
        if (instance.state !== 'running') return; // a failed action stops the flow
        instance = this._advance(instanceId);
        continue;
      }
      if (step.type === 'timer') {
        // Timers are resolved by tick(); stop here until the clock moves.
        this._notifyApprovers(instanceId, step);
        return;
      }
      // approval. If it belongs to a parallel group, activate every
      // member of the group at once so all can be decided concurrently.
      if (step.parallel_group) {
        for (const member of def.steps.filter((s) => s.parallel_group === step.parallel_group)) {
          const st = this.get(instanceId).step_states.find((x) => x.step_id === member.id);
          if (st.state === 'pending') {
            this._markStep(instanceId, member.id, { state: 'active', started_at: this.clock.nowIso() });
          }
          this._notifyApprovers(instanceId, member);
        }
        return;
      }
      this._notifyApprovers(instanceId, step);
      return;
    }
    this._complete(instanceId, 'approved');
  }

  // ── Approvals, delegation, parallel ────────────────────────────────

  /**
   * Record an approval decision. Handles N-of-M, any-of roles, and
   * parallel groups (a decision may satisfy several active steps).
   */
  decide(instanceId, stepId, approverRef, { decision = 'approve', note } = {}) {
    const instance = this.get(instanceId);
    if (instance.state !== 'running') throw err('STATE_CONFLICT', `Workflow is ${instance.state}`);
    const def = this._definitionFor(instance);
    const step = def.steps.find((s) => s.id === stepId);
    if (!step || step.type !== 'approval') throw err('INVALID_ARGUMENT', `No approval step ${stepId}`);
    const stepState = instance.step_states.find((s) => s.step_id === stepId);
    if (stepState.state !== 'active') throw err('STATE_CONFLICT', `Step ${stepId} is ${stepState.state}`);

    this._assertEligible(step, approverRef, instance.context, stepState);
    if (stepState.approvals.some((a) => a.approver_ref === approverRef)) {
      throw err('STATE_CONFLICT', 'This approver already decided — distinct approvers required');
    }
    const approvals = [
      ...stepState.approvals,
      { approver_ref: approverRef, decision, note: note || null, ts: this.clock.nowIso() },
    ];
    this._markStep(instanceId, stepId, { approvals });
    this.audit.append(approverRef, 'workflow.decision', instanceRef(instance), null, {
      step_id: stepId,
      decision,
    });

    if (decision === 'reject') {
      this._complete(instanceId, 'rejected');
      return this.get(instanceId);
    }
    const required = step.approvals_required || 1;
    const approveCount = approvals.filter((a) => a.decision === 'approve').length;
    if (approveCount >= required) {
      this._markStep(instanceId, stepId, { state: 'approved' });
      this.bus.publish('workflow.step.completed', { instance_id: instanceId, step_id: stepId });
      this._maybeAdvancePastParallel(instanceId, step);
    }
    return this.get(instanceId);
  }

  /** Delegate this step's approval authority to another eligible actor. */
  delegate(instanceId, stepId, fromRef, toRef, actor) {
    const instance = this.get(instanceId);
    const stepState = instance.step_states.find((s) => s.step_id === stepId);
    if (!stepState || stepState.state !== 'active') {
      throw err('STATE_CONFLICT', 'Can only delegate an active step');
    }
    this._markStep(instanceId, stepId, { delegated: { ...stepState.delegated, [toRef]: fromRef } });
    this.audit.append(actor || fromRef, 'workflow.delegated', instanceRef(instance), null, {
      step_id: stepId,
      from: fromRef,
      to: toRef,
    });
    return this.get(instanceId);
  }

  /**
   * Scheduler tick: resolve timers and step timeouts (escalate / reject
   * / auto-approve). Idempotent — safe to call on any cadence.
   */
  tick() {
    const now = this.clock.nowMs();
    let transitions = 0;
    for (const instance of this.instances.find((i) => i.state === 'running')) {
      const def = this._definitionFor(instance);
      const step = def.steps[instance.current_step_index];
      if (!step) continue;
      const stepState = instance.step_states.find((s) => s.step_id === step.id);
      if (step.type === 'timer' && stepState.state === 'active') {
        if (stepState.deadline && now >= stepState.deadline) {
          this._markStep(instance.id, step.id, { state: 'elapsed' });
          this._advance(instance.id);
          this._enterStep(instance.id);
          transitions += 1;
        }
        continue;
      }
      if (step.type === 'approval' && stepState.state === 'active' && stepState.deadline && now >= stepState.deadline) {
        const onTimeout = step.on_timeout || 'escalate';
        if (onTimeout === 'reject') {
          this._complete(instance.id, 'rejected');
        } else if (onTimeout === 'auto_approve') {
          this._markStep(instance.id, step.id, { state: 'approved', auto: true });
          this._maybeAdvancePastParallel(instance.id, step);
        } else {
          // escalate: widen the deadline and notify the escalation role.
          this._markStep(instance.id, step.id, {
            deadline: now + (step.timeout_ms || 0),
            escalated: true,
          });
          this._notifyEscalation(instance.id, step);
        }
        transitions += 1;
      }
    }
    return { transitions };
  }

  // ── Internals ──────────────────────────────────────────────────────

  _assertEligible(step, approverRef, context, stepState) {
    this.identity.get(approverRef); // must exist
    // Delegated authority counts.
    if (stepState.delegated && stepState.delegated[approverRef]) return;
    const roleSpecs = step.roles || [];
    if (roleSpecs.length === 0) return; // open approval (any authenticated actor)
    const ok = roleSpecs.some((spec) => {
      const scope = spec.scope_from ? `${spec.scope_prefix || ''}${context[spec.scope_from]}` : spec.scope;
      return scope
        ? this.identity.hasRole(approverRef, spec.role, scope)
        : this.identity.users.get(approverRef); // role with no scope: level check below
    });
    if (!ok) {
      throw err('PERMISSION_DENIED', `Approver lacks a required role for step ${step.id}`);
    }
    if (step.min_level) this.identity.requireLevel(approverRef, step.min_level);
  }

  _evaluateCondition(condition, context) {
    const op = CONDITION_OPS[condition.op];
    if (!op) throw err('INVALID_ARGUMENT', `Unknown condition op ${condition.op}`);
    return op(context[condition.field], condition.value);
  }

  _runAction(instanceId, step) {
    const instance = this.get(instanceId);
    const handler = this.handlers.get(step.action);
    if (!handler) {
      this._markStep(instanceId, step.id, { state: 'skipped', reason: 'no_handler' });
      return;
    }
    try {
      const result = handler(instance, step, instance.context);
      // A handler may return { context: {...} } to feed later steps
      // (e.g. open_election → election_id used by close_election).
      if (result && result.context) {
        this.instances.update(instanceId, {
          context: { ...instance.context, ...result.context },
        });
      }
      this._markStep(instanceId, step.id, { state: 'done', result: result || null });
      this.audit.append('system:workflow', 'workflow.action', instanceRef(instance), null, {
        step_id: step.id,
        action: step.action,
      });
    } catch (e) {
      this._markStep(instanceId, step.id, { state: 'failed', error: e.message });
      this._complete(instanceId, 'failed');
    }
  }

  _maybeAdvancePastParallel(instanceId, step) {
    // If the step is part of a parallel group, advance only once every
    // member of the group is resolved; otherwise advance immediately.
    const instance = this.get(instanceId);
    const def = this._definitionFor(instance);
    if (step.parallel_group) {
      const groupSteps = def.steps.filter((s) => s.parallel_group === step.parallel_group);
      const allDone = groupSteps.every((s) => {
        const st = instance.step_states.find((x) => x.step_id === s.id);
        return ['approved', 'skipped', 'done'].includes(st.state);
      });
      if (!allDone) return;
      // Jump the cursor past every member of the group in one move.
      const lastIndex = Math.max(
        ...groupSteps.map((s) => def.steps.findIndex((x) => x.id === s.id))
      );
      this.instances.update(instanceId, { current_step_index: lastIndex + 1 });
      this._enterStep(instanceId);
      return;
    }
    this._advance(instanceId);
    this._enterStep(instanceId);
  }

  _advance(instanceId) {
    const instance = this.get(instanceId);
    return this.instances.update(instanceId, {
      current_step_index: instance.current_step_index + 1,
    });
  }

  _complete(instanceId, outcome) {
    const instance = this.instances.update(instanceId, {
      state: outcome === 'approved' ? 'completed' : outcome,
      completed_at: this.clock.nowIso(),
      outcome,
    });
    this.audit.append('system:workflow', 'workflow.completed', instanceRef(instance), null, { outcome });
    this.bus.publish('workflow.completed', { instance_id: instanceId, outcome });
    return instance;
  }

  _notifyApprovers(instanceId, step) {
    if (!this.notifications || !step.roles) return;
    const instance = this.get(instanceId);
    for (const spec of step.roles) {
      const scope = spec.scope_from ? `${spec.scope_prefix || ''}${instance.context[spec.scope_from]}` : spec.scope;
      for (const grant of this.identity.roles.find(
        (g) => g.role === spec.role && (!scope || g.scope === scope) && !g.suspended
      )) {
        this.notifications.notify(grant.user_ref, {
          category: 'approvals',
          title: `Approval needed: ${step.name || step.id}`,
          body: `${instance.definition_key} awaiting your decision`,
          ref: instanceRef(instance),
        });
      }
    }
  }

  _notifyEscalation(instanceId, step) {
    if (!this.notifications || !step.escalate_to) return;
    const instance = this.get(instanceId);
    const spec = step.escalate_to;
    const scope = spec.scope_from ? `${spec.scope_prefix || ''}${instance.context[spec.scope_from]}` : spec.scope;
    for (const grant of this.identity.roles.find(
      (g) => g.role === spec.role && (!scope || g.scope === scope) && !g.suspended
    )) {
      this.notifications.notify(grant.user_ref, {
        category: 'approvals',
        title: `ESCALATED: ${step.name || step.id}`,
        body: `${instance.definition_key} timed out and needs your attention`,
        ref: instanceRef(instance),
      });
    }
  }

  _markStep(instanceId, stepId, patch) {
    const instance = this.get(instanceId);
    this.instances.update(instanceId, {
      step_states: instance.step_states.map((s) => (s.step_id === stepId ? { ...s, ...patch } : s)),
    });
  }

  _definitionFor(instance) {
    const def = this.definitions.findOne(
      (d) => d.key === instance.definition_key && d.version === instance.definition_version
    );
    if (!def) throw err('NOT_FOUND', `Workflow definition ${instance.definition_key} v${instance.definition_version} missing`);
    return def;
  }
}

function instanceRef(instance) {
  return `workflow_instance:${instance.id}`;
}

module.exports = { WorkflowService };
