'use strict';
// Government Service Portfolio Management (Phase 64). Treats digital government services as
// managed strategic PRODUCTS: a service registry with ownership, funding tracking, lifecycle,
// maturity, dependency analysis, health metrics, strategic-value assessment, retirement
// planning, and portfolio-optimization RECOMMENDATIONS. Recommendations are ADVISORY.
// Deterministic.
const LIFECYCLE = ['proposed', 'live', 'sunset', 'retired'];
const MATURITY = ['initial', 'managed', 'defined', 'optimised'];

class ServicePortfolio {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._services = new Map(); }

  register(id, { owner, fundingPerYear = 0, maturity = 'initial', strategicValue = 'medium', dependsOn = [] } = {}) {
    if (!id || !owner) throw new Error('service id and owner are required');
    if (!MATURITY.includes(maturity)) throw new Error('invalid maturity');
    this._services.set(id, { id, owner, fundingPerYear, maturity, strategicValue, dependsOn: [...dependsOn], stage: 'proposed', usage: 0, incidents: 0 });
    return this.describe(id);
  }
  describe(id) { const s = this._must(id); return { id: s.id, owner: s.owner, stage: s.stage, maturity: s.maturity, strategicValue: s.strategicValue, fundingPerYear: s.fundingPerYear, dependsOn: [...s.dependsOn] }; }
  catalog() { return [...this._services.keys()].map((id) => this.describe(id)); }

  transition(id, stage) { const s = this._must(id); if (!LIFECYCLE.includes(stage)) throw new Error('invalid lifecycle stage'); s.stage = stage; return this.describe(id); }
  recordMetrics(id, { usage, incidents } = {}) { const s = this._must(id); if (usage != null) s.usage = usage; if (incidents != null) s.incidents = incidents; return { id, usage: s.usage, incidents: s.incidents }; }

  // Dependency analysis (service → services it depends on) + reverse impact.
  dependencyMap() { const m = {}; for (const s of this._services.values()) m[s.id] = [...s.dependsOn]; return m; }
  impact(id) { this._must(id); return [...this._services.values()].filter((s) => s.dependsOn.includes(id)).map((s) => s.id); }

  // Service health: deterministic from stage, maturity, and incident load.
  health(id) {
    const s = this._must(id);
    let score = ({ initial: 0.5, managed: 0.7, defined: 0.85, optimised: 1 })[s.maturity];
    if (s.stage === 'sunset') score -= 0.2; if (s.stage === 'retired') score -= 0.5;
    if (s.incidents > 0) score -= Math.min(0.3, s.incidents * 0.05);
    score = +Math.max(0, Math.min(1, score)).toFixed(2);
    return { id, health: score, band: score >= 0.8 ? 'healthy' : score >= 0.5 ? 'watch' : 'at-risk' };
  }
  // Strategic value assessment: value vs cost (usage per funding unit).
  strategicAssessment(id) { const s = this._must(id); const efficiency = s.fundingPerYear ? +(s.usage / s.fundingPerYear).toFixed(4) : null; return { id, strategicValue: s.strategicValue, fundingPerYear: s.fundingPerYear, usage: s.usage, efficiency }; }

  // Portfolio optimization RECOMMENDATIONS (advisory) — sunset low-value/at-risk services;
  // invest in high-value healthy ones. Never auto-applied.
  recommendations() {
    const recs = [];
    for (const s of this._services.values()) {
      const h = this.health(s.id);
      if (h.band === 'at-risk' && s.strategicValue === 'low') recs.push({ service: s.id, action: 'plan-retirement', rationale: 'low value + at-risk health' });
      if (h.band === 'healthy' && s.strategicValue === 'high' && s.maturity !== 'optimised') recs.push({ service: s.id, action: 'invest-to-optimise', rationale: 'high strategic value, room to mature' });
    }
    return { recommendations: recs, advisoryOnly: true, note: 'Advisory — portfolio decisions remain human-approved.' };
  }
  _must(id) { const s = this._services.get(id); if (!s) throw new Error('unknown service: ' + id); return s; }
}

module.exports = { ServicePortfolio, LIFECYCLE, MATURITY };
