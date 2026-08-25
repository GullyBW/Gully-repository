'use strict';
// Recovery Strategy Evaluation (Stabilization Part 8). Extends human-governed recovery from a
// single playbook lookup to a comparison of MULTIPLE strategies, each evaluated on Recovery
// Time Objective, Recovery Point Objective, operational disruption, resource requirements,
// data integrity and business continuity.
//
// Deterministic and explainable: every score shows its contributing terms. Recommendations stay
// ADVISORY until a NAMED human authority authorizes one — selection without authorization is
// refused (fail-closed).

// The strategy catalogue. Objectives are in minutes; the qualitative dimensions are 0..1 where
// 1 is best (least disruption, least resource need, highest integrity, highest continuity).
const STRATEGIES = {
  'backup-restore': {
    name: 'Restore from verified backup', rtoMinutes: 240, rpoMinutes: 60,
    operationalDisruption: 0.2, resourceEfficiency: 0.9, dataIntegrity: 0.9, businessContinuity: 0.3,
    applicableTo: ['data-loss', 'corruption', 'regional-outage', 'cyber-incident'],
    prerequisites: ['A restore-verified backup exists (INFRA-FIT-DR-BACKUP-RESTORE).'],
    tradeoff: 'Cheapest and simplest, but the whole RPO window of work is lost and service is down for hours.',
  },
  'warm-standby': {
    name: 'Promote warm standby', rtoMinutes: 30, rpoMinutes: 5,
    operationalDisruption: 0.5, resourceEfficiency: 0.5, dataIntegrity: 0.8, businessContinuity: 0.7,
    applicableTo: ['regional-outage', 'infrastructure-failure', 'surge'],
    prerequisites: ['A replicated standby is provisioned and its replication lag is monitored.'],
    tradeoff: 'Fast and affordable, but replication lag defines the data loss and promotion is a one-way door under pressure.',
  },
  'active-active': {
    name: 'Shift traffic between active regions', rtoMinutes: 5, rpoMinutes: 0,
    operationalDisruption: 0.8, resourceEfficiency: 0.2, dataIntegrity: 0.9, businessContinuity: 0.95,
    applicableTo: ['regional-outage', 'infrastructure-failure', 'surge'],
    prerequisites: ['Multi-region active-active with quorum writes and zone isolation preserved.'],
    tradeoff: 'Near-zero interruption, but it is the most expensive posture and cross-region consistency must never breach zone isolation.',
  },
  'rebuild-from-events': {
    name: 'Rebuild read models from the event log', rtoMinutes: 90, rpoMinutes: 0,
    operationalDisruption: 0.4, resourceEfficiency: 0.8, dataIntegrity: 1, businessContinuity: 0.5,
    applicableTo: ['corruption', 'projection-failure', 'cyber-incident'],
    prerequisites: ['The hash-chained event log verifies end to end.'],
    tradeoff: 'Highest integrity — the log is the source of truth — but it only recovers derived state, not the log itself.',
  },
  'degraded-mode': {
    name: 'Operate in degraded mode', rtoMinutes: 10, rpoMinutes: 0,
    operationalDisruption: 0.9, resourceEfficiency: 0.95, dataIntegrity: 1, businessContinuity: 0.4,
    applicableTo: ['surge', 'infrastructure-failure', 'regional-outage', 'cyber-incident'],
    prerequisites: ['Non-critical load can be shed without touching the anonymous intake path.'],
    tradeoff: 'Keeps the constitutional path (anonymous reporting) alive immediately, at the cost of most other capability.',
  },
  'isolate-and-rebuild': {
    name: 'Isolate the affected zone and rebuild', rtoMinutes: 480, rpoMinutes: 15,
    operationalDisruption: 0.9, resourceEfficiency: 0.4, dataIntegrity: 0.95, businessContinuity: 0.2,
    applicableTo: ['cyber-incident', 'key-compromise'],
    prerequisites: ['Custody and audit chains are preserved before isolation; credentials rotated on rebuild.'],
    tradeoff: 'The only safe answer to a suspected compromise, and the most disruptive — containment beats availability here.',
  },
};

// Default weights. They are DATA: an incident commander may re-weigh, and the report shows how.
const DEFAULT_WEIGHTS = { rto: 0.25, rpo: 0.25, disruption: 0.15, resources: 0.1, integrity: 0.15, continuity: 0.1 };

// Normalise an objective (lower is better) into 0..1 against the worst value in the catalogue.
function normaliseObjective(value, worst) { return worst === 0 ? 1 : +(1 - Math.min(value, worst) / worst).toFixed(3); }

class RecoveryStrategyEvaluator {
  constructor({ clock = () => Date.now(), strategies = STRATEGIES } = {}) {
    this._clock = clock; this._strategies = strategies; this._authorizations = new Map(); this._audit = []; this._seq = 0;
  }

  catalogue() { return Object.entries(this._strategies).map(([id, s]) => ({ id, ...s })); }
  describe(id) { const s = this._strategies[id]; if (!s) throw new Error('unknown recovery strategy: ' + id); return { id, ...s }; }

  // Evaluate every applicable strategy for an incident. Deterministic and explainable: each
  // result carries its per-dimension contribution, so a ranking can always be argued with.
  evaluate({ incidentType, weights = DEFAULT_WEIGHTS, constraints = {} } = {}) {
    const all = this.catalogue();
    const worstRto = Math.max(...all.map((s) => s.rtoMinutes));
    const worstRpo = Math.max(...all.map((s) => s.rpoMinutes)) || 1;
    const applicable = all.filter((s) => !incidentType || s.applicableTo.includes(incidentType));
    const scored = applicable.map((s) => {
      const terms = {
        rto: +(weights.rto * normaliseObjective(s.rtoMinutes, worstRto)).toFixed(4),
        rpo: +(weights.rpo * normaliseObjective(s.rpoMinutes, worstRpo)).toFixed(4),
        disruption: +(weights.disruption * (1 - s.operationalDisruption)).toFixed(4),
        resources: +(weights.resources * s.resourceEfficiency).toFixed(4),
        integrity: +(weights.integrity * s.dataIntegrity).toFixed(4),
        continuity: +(weights.continuity * s.businessContinuity).toFixed(4),
      };
      const score = +Object.values(terms).reduce((a, b) => a + b, 0).toFixed(4);
      const violations = [];
      if (constraints.maxRtoMinutes != null && s.rtoMinutes > constraints.maxRtoMinutes) violations.push(`RTO ${s.rtoMinutes}m exceeds the ${constraints.maxRtoMinutes}m objective`);
      if (constraints.maxRpoMinutes != null && s.rpoMinutes > constraints.maxRpoMinutes) violations.push(`RPO ${s.rpoMinutes}m exceeds the ${constraints.maxRpoMinutes}m objective`);
      if (constraints.minDataIntegrity != null && s.dataIntegrity < constraints.minDataIntegrity) violations.push(`data integrity ${s.dataIntegrity} below the required ${constraints.minDataIntegrity}`);
      return { id: s.id, name: s.name, rtoMinutes: s.rtoMinutes, rpoMinutes: s.rpoMinutes, terms, score, meetsConstraints: violations.length === 0, violations, tradeoff: s.tradeoff, prerequisites: s.prerequisites };
    });
    // Deterministic ordering: constraint-meeting first, then score, then id.
    scored.sort((a, b) => (b.meetsConstraints - a.meetsConstraints) || (b.score - a.score) || a.id.localeCompare(b.id));
    return { incidentType: incidentType || 'any', weights: { ...weights }, constraints: { ...constraints }, evaluated: scored.length, strategies: scored };
  }

  // Side-by-side comparison of named strategies on every dimension.
  compare(ids) {
    const rows = ids.map((id) => this.describe(id));
    return {
      dimensions: ['rtoMinutes', 'rpoMinutes', 'operationalDisruption', 'resourceEfficiency', 'dataIntegrity', 'businessContinuity'],
      strategies: rows.map((s) => ({ id: s.id, name: s.name, rtoMinutes: s.rtoMinutes, rpoMinutes: s.rpoMinutes, operationalDisruption: s.operationalDisruption, resourceEfficiency: s.resourceEfficiency, dataIntegrity: s.dataIntegrity, businessContinuity: s.businessContinuity, tradeoff: s.tradeoff })),
      bestBy: {
        rto: rows.slice().sort((a, b) => a.rtoMinutes - b.rtoMinutes)[0].id,
        rpo: rows.slice().sort((a, b) => a.rpoMinutes - b.rpoMinutes)[0].id,
        dataIntegrity: rows.slice().sort((a, b) => b.dataIntegrity - a.dataIntegrity)[0].id,
        businessContinuity: rows.slice().sort((a, b) => b.businessContinuity - a.businessContinuity)[0].id,
      },
    };
  }

  // Recommend a strategy — ADVISORY. It produces a recommendation record that a named human
  // must authorize before anything may be selected.
  recommend({ incidentType, weights = DEFAULT_WEIGHTS, constraints = {} } = {}) {
    const evaluation = this.evaluate({ incidentType, weights, constraints });
    const viable = evaluation.strategies.filter((s) => s.meetsConstraints);
    const id = 'RSR-' + (++this._seq).toString().padStart(4, '0');
    const recommended = viable[0] || null;
    const rec = { id, incidentType: incidentType || 'any', recommended: recommended ? recommended.id : null, alternatives: viable.slice(1, 4).map((s) => s.id), rejected: evaluation.strategies.filter((s) => !s.meetsConstraints).map((s) => ({ id: s.id, violations: s.violations })), evaluation, status: 'recommended', authorizedBy: null };
    this._authorizations.set(id, rec);
    this._log('recommended', id);
    return {
      id, incidentType: rec.incidentType, recommended: rec.recommended, alternatives: rec.alternatives, rejected: rec.rejected,
      explanation: recommended ? `${recommended.name}: score ${recommended.score} — ${recommended.tradeoff}` : 'No strategy satisfies the stated objectives; human triage is required.',
      ranking: evaluation.strategies.map((s) => ({ id: s.id, score: s.score, meetsConstraints: s.meetsConstraints })),
      advisoryOnly: true, requiresHumanAuthorization: true,
      note: 'Recommendation only. A recovery strategy is never selected or executed without explicit authorization by a named human authority.',
    };
  }

  // A NAMED human authority authorizes a strategy for a recommendation (rationale required).
  authorize(recommendationId, { by, rationale, strategy = null } = {}) {
    const rec = this._must(recommendationId);
    if (!by || !rationale) throw new Error('recovery strategy authorization requires a named human authority and a rationale');
    const chosen = strategy || rec.recommended;
    if (!chosen) throw new Error('no strategy to authorize — human triage required');
    this.describe(chosen); // fail-closed on an unknown strategy
    rec.status = 'authorized'; rec.authorizedBy = by; rec.rationale = rationale; rec.strategy = chosen;
    this._log('authorized', recommendationId, by);
    return { id: recommendationId, strategy: chosen, status: 'authorized', authorizedBy: by, rationale };
  }

  // The selected strategy — available ONLY after human authorization (fail-closed).
  selected(recommendationId) {
    const rec = this._must(recommendationId);
    if (rec.status !== 'authorized') { const e = new Error('no recovery strategy selected — human authorization required'); e.failClosed = true; throw e; }
    return { id: recommendationId, strategy: rec.strategy, authorizedBy: rec.authorizedBy, rationale: rec.rationale, prerequisites: this.describe(rec.strategy).prerequisites };
  }

  auditTrail() { return this._audit.map((a) => ({ ...a })); }
  _log(event, id, actor) { this._audit.push({ at: this._clock(), event, recommendation: id, actor: actor || 'system' }); }
  _must(id) { const r = this._authorizations.get(id); if (!r) throw new Error('unknown recovery recommendation: ' + id); return r; }
}

module.exports = { RecoveryStrategyEvaluator, STRATEGIES, DEFAULT_WEIGHTS };
