'use strict';

/**
 * Cross-Plane Audit Graph (DPI requirement #6). A unified, forensic view
 * over the Event Store that links identity events, policy decisions, AI
 * retrievals, data-product reads, cell crossings and financial ledger
 * events into one causal graph — keyed by a correlation id threaded through
 * a request. Supports forensic tracing, replay and compliance reporting.
 *
 * It is a pure read model: it never writes, and derives everything from the
 * immutable log, so a trace is fully reproducible.
 */
class AuditGraph {
  constructor({ eventStore }) {
    this.eventStore = eventStore;
  }

  /** All governed events sharing a correlation id, as nodes + causal edges. */
  trace(correlationId) {
    const events = this.eventStore
      .read({})
      .filter((e) => e.data && e.data.correlation_id === correlationId)
      .sort((a, b) => a.seq - b.seq);

    const nodes = events.map((e) => ({
      id: e.id,
      seq: e.seq,
      plane: (e.data && e.data.plane) || planeOf(e.type),
      type: e.type,
      at: e.occurred_at,
      ref: e.stream_id,
      decision: (e.data && e.data.decision) || null,
    }));

    const byId = new Map(events.map((e) => [e.id, e]));
    const edges = [];
    for (const e of events) {
      const cause = e.data && e.data.causation_id;
      if (cause && byId.has(cause)) edges.push({ from: cause, to: e.id, kind: 'causation' });
    }
    // Chain by sequence for a readable timeline of the request.
    for (let i = 1; i < events.length; i += 1) {
      edges.push({ from: events[i - 1].id, to: events[i].id, kind: 'sequence' });
    }

    return {
      correlation_id: correlationId,
      nodes,
      edges,
      planes: [...new Set(nodes.map((n) => n.plane))],
      complete: nodes.length > 0,
    };
  }

  /** Governance activity by plane — the compliance dashboard rollup. */
  summary(filter = {}) {
    const events = this.eventStore.read(filter);
    const byPlane = {};
    const decisions = { ALLOW: 0, DENY: 0, STEP_UP_AUTH: 0 };
    for (const e of events) {
      const plane = (e.data && e.data.plane) || planeOf(e.type);
      byPlane[plane] = (byPlane[plane] || 0) + 1;
      if (e.type === 'policy.decided' && e.data && decisions[e.data.decision] !== undefined) {
        decisions[e.data.decision] += 1;
      }
    }
    return { total: events.length, by_plane: byPlane, policy_decisions: decisions };
  }
}

function planeOf(type) {
  const t = String(type);
  if (t.startsWith('policy.')) return 'policy';
  if (t.startsWith('ai.')) return 'ai';
  if (t.startsWith('data.')) return 'data';
  if (t.startsWith('cell.')) return 'cell';
  if (t.startsWith('identity.')) return 'identity';
  if (t.startsWith('ledger.') || t.startsWith('card.') || t.startsWith('payments.')) return 'ledger';
  if (t.startsWith('qr.')) return 'qr';
  return 'domain';
}

module.exports = { AuditGraph, planeOf };
