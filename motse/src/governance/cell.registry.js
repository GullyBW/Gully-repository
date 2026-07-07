'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Cell-based sovereign architecture (DPI requirement #4 & #9). A cell is an
 * isolated deployment unit — its own event-store partition, ledger shard,
 * policy kernel and AI gateway — serving a bounded set of tenants in a data-
 * residency zone. This registry models the logical contract that the
 * physical topology (K8s per-cell) enforces:
 *
 *   - NO implicit cross-cell access (`assertSameCell` fails closed);
 *   - every cross-cell interaction is EXPLICIT, policy-approved and logged;
 *   - each cell declares a failure-containment contract (blast radius,
 *     degraded mode, offline behaviour, recovery strategy) so a failure in
 *     one cell cannot cascade to others.
 */
class CellRegistry {
  constructor({ clock, audit, bus, policyKernel } = {}) {
    this.clock = clock;
    this.audit = audit;
    this.bus = bus;
    this.policyKernel = policyKernel;
    this.cells = new Map();
    if (bus) bus.register('cell.cross_access', 1, ['from_cell', 'to_cell', 'decision']);
  }

  register({ id: cellId, region = 'default', residency = 'default', maxFailureRadius = 'cell', degradedMode = 'read_only', offline = 'queue_and_reconcile' }) {
    if (!cellId) throw err('INVALID_ARGUMENT', 'cell id is required');
    const cell = {
      id: cellId, region, residency, max_failure_radius: maxFailureRadius,
      degraded_mode: degradedMode, offline, state: 'healthy', registered_at: this.clock.nowIso(),
    };
    this.cells.set(cellId, cell);
    return { ...cell };
  }

  get(cellId) {
    const cell = this.cells.get(cellId);
    if (!cell) throw err('NOT_FOUND', `No cell ${cellId}`);
    return cell;
  }

  /** Fail-closed guard: two operations must be in the same cell. */
  assertSameCell(a, b) {
    if (a !== b) throw err('PERMISSION_DENIED', 'implicit cross-cell access denied', { from_cell: a, to_cell: b });
    return true;
  }

  /**
   * The ONLY sanctioned way to cross a cell boundary: explicit, policy-
   * approved and logged. `assertion` is the acting identity; the Policy
   * Kernel must ALLOW a `cell.<action>` before the work runs.
   */
  crossCell({ fromCell, toCell, action, assertion, tenant = 'motse', correlationId = null }, fn) {
    this.get(fromCell);
    this.get(toCell);
    const decision = this.policyKernel.decide({
      assertion, tenant, action: `cell.${action}`,
      resource: { id: `cell:${toCell}`, classification: 'restricted', required_role: 'cell_operator', required_scope: 'platform' },
      context: { correlationId, cross_cell: true, from_cell: fromCell, to_cell: toCell },
    });
    if (this.bus) {
      this.bus.publish('cell.cross_access', {
        from_cell: fromCell, to_cell: toCell, action, decision: decision.decision,
        policy_decision_id: decision.policy_decision_id, tenant, subject: assertion ? assertion.subject : null,
        correlation_id: correlationId, plane: 'cell', stream_id: `cell:${toCell}`,
      });
    }
    if (this.audit) {
      this.audit.append(assertion && assertion.subject ? assertion.subject : 'system', 'cell.cross_access', `cell:${toCell}`, null, {
        from: fromCell, action, decision: decision.decision,
      });
    }
    if (decision.decision !== 'ALLOW') {
      throw err('PERMISSION_DENIED', 'cross-cell access denied by policy', { decision: decision.decision, reason: decision.reason });
    }
    const eventId = id('xcl');
    return { cross_call_id: eventId, result: fn() };
  }

  describe() {
    return [...this.cells.values()].map((c) => ({ ...c }));
  }

  /** Failure-containment contract for a cell (blast radius + recovery). */
  contract(cellId) {
    const c = this.get(cellId);
    return {
      cell: c.id, region: c.region, residency: c.residency,
      max_failure_radius: c.max_failure_radius, degraded_mode: c.degraded_mode,
      offline_behaviour: c.offline, recovery_strategy: 'event_replay_reconciliation',
    };
  }

  setState(cellId, state) {
    this.get(cellId);
    this.cells.set(cellId, { ...this.cells.get(cellId), state });
    return this.get(cellId);
  }
}

module.exports = { CellRegistry };
