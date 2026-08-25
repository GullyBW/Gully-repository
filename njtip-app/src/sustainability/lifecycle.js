'use strict';
// Long-Term Sustainability & Lifecycle Management (Phase 69). Governance for decades-long
// platform sustainability: a technology-lifecycle registry, a modernization roadmap,
// dependency-retirement planning, obsolescence monitoring, strategic-investment planning,
// lifecycle forecasting, platform-sustainability metrics, and architectural-longevity
// assessment. All recommendations are ADVISORY. Deterministic (caller supplies `now`).
const YEAR = 365 * 24 * 3600_000;
const STATUS = ['emerging', 'current', 'mature', 'legacy', 'end-of-life'];

class LifecycleRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._techs = new Map(); }

  register(id, { category, adoptedAt, eolAt, criticality = 'medium' } = {}) {
    if (!id || !category) throw new Error('technology id and category are required');
    this._techs.set(id, { id, category, adoptedAt: adoptedAt ?? this._clock(), eolAt: eolAt ?? (this._clock() + 5 * YEAR), criticality });
    return this.describe(id);
  }
  describe(id, now = this._clock()) { const t = this._must(id); return { id: t.id, category: t.category, criticality: t.criticality, status: this._status(t, now), yearsToEol: +((t.eolAt - now) / YEAR).toFixed(2) }; }
  _status(t, now) { const life = t.eolAt - t.adoptedAt; const age = now - t.adoptedAt; const frac = life > 0 ? age / life : 1; if (now >= t.eolAt) return 'end-of-life'; if (frac >= 0.8) return 'legacy'; if (frac >= 0.4) return 'mature'; if (frac >= 0.1) return 'current'; return 'emerging'; }

  // Obsolescence monitoring: technologies at/near end-of-life (advisory).
  obsolescence(now = this._clock(), { horizonYears = 1 } = {}) {
    return [...this._techs.values()].map((t) => this.describe(t.id, now)).filter((d) => d.status === 'end-of-life' || d.yearsToEol <= horizonYears);
  }
  // Modernization roadmap: order legacy/EOL technologies by criticality + urgency (advisory).
  modernizationRoadmap(now = this._clock()) {
    const rank = { critical: 3, high: 2, medium: 1, low: 0 };
    return [...this._techs.values()].map((t) => this.describe(t.id, now))
      .filter((d) => ['legacy', 'end-of-life'].includes(d.status))
      .sort((a, b) => (rank[b.criticality] - rank[a.criticality]) || (a.yearsToEol - b.yearsToEol))
      .map((d) => ({ technology: d.id, action: d.status === 'end-of-life' ? 'replace-now' : 'plan-modernization', criticality: d.criticality, yearsToEol: d.yearsToEol }));
  }
  // Platform sustainability metrics: distribution of statuses + a sustainability score.
  sustainabilityMetrics(now = this._clock()) {
    const rows = [...this._techs.values()].map((t) => this.describe(t.id, now));
    const byStatus = {}; for (const r of rows) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
    const eol = (byStatus['end-of-life'] || 0) + (byStatus['legacy'] || 0);
    const score = rows.length ? +(1 - eol / rows.length).toFixed(2) : 1;
    return { technologies: rows.length, byStatus, sustainabilityScore: score, band: score >= 0.8 ? 'healthy' : score >= 0.5 ? 'watch' : 'at-risk' };
  }
  // Architectural longevity assessment (advisory, human-gated).
  longevityAssessment(now = this._clock()) { const m = this.sustainabilityMetrics(now); return { sustainabilityScore: m.sustainabilityScore, band: m.band, obsolescenceRisks: this.obsolescence(now).length, humanGate: true, note: 'Advisory longevity assessment; investment/retirement decisions are human-approved.' }; }
  _must(id) { const t = this._techs.get(id); if (!t) throw new Error('unknown technology: ' + id); return t; }
}

module.exports = { LifecycleRegistry, STATUS };
