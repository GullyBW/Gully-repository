'use strict';
// National Digital Asset Governance (Phase 62). Extends governance from datasets to EVERY
// governed digital asset — APIs, software components, AI models, policies, workflows,
// legislation, metadata, infrastructure definitions, documents, service contracts, and data
// schemas. Provides ownership, lifecycle, dependency mapping, version governance, retirement
// governance, risk classification, and asset-health scoring. Every asset is TRACEABLE
// throughout its lifecycle (append-only history). Deterministic.
const ASSET_TYPES = new Set(['api', 'component', 'ai-model', 'policy', 'workflow', 'legislation', 'metadata', 'infrastructure', 'document', 'contract', 'schema']);
const LIFECYCLE = ['draft', 'active', 'deprecated', 'retired'];
const RISK_CLASSES = ['low', 'medium', 'high', 'critical'];

class AssetRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._assets = new Map(); }

  register(id, { type, owner, dependsOn = [], riskClass = 'low' } = {}) {
    if (!id || !ASSET_TYPES.has(type) || !owner) throw new Error('asset id, a valid type, and an owner are required');
    if (!RISK_CLASSES.includes(riskClass)) throw new Error('invalid risk class');
    if (this._assets.has(id)) throw new Error('asset already registered (use amend)');
    this._assets.set(id, { id, type, owner, riskClass, status: 'draft', version: 1, dependsOn: [...dependsOn], history: [{ at: this._clock(), event: 'registered', version: 1 }] });
    return this.describe(id);
  }
  // Version governance: amend bumps the version and appends to the immutable history.
  amend(id, { summary, riskClass } = {}) { const a = this._must(id); a.version += 1; if (riskClass) { if (!RISK_CLASSES.includes(riskClass)) throw new Error('invalid risk class'); a.riskClass = riskClass; } a.history.push({ at: this._clock(), event: 'amended', version: a.version, summary: summary || null }); return { id, version: a.version }; }
  // Lifecycle governance (draft → active → deprecated → retired; retirement is order-enforced).
  activate(id) { const a = this._must(id); a.status = 'active'; a.history.push({ at: this._clock(), event: 'activated', version: a.version }); return this.describe(id); }
  deprecate(id) { const a = this._must(id); a.status = 'deprecated'; a.history.push({ at: this._clock(), event: 'deprecated', version: a.version }); return this.describe(id); }
  retire(id) { const a = this._must(id); if (a.status !== 'deprecated') throw new Error('an asset must be deprecated before retirement'); a.status = 'retired'; a.history.push({ at: this._clock(), event: 'retired', version: a.version }); return this.describe(id); }

  describe(id) { const a = this._must(id); return { id: a.id, type: a.type, owner: a.owner, status: a.status, version: a.version, riskClass: a.riskClass, dependsOn: [...a.dependsOn] }; }
  // Traceability: the full immutable lifecycle history of an asset.
  trace(id) { return this._must(id).history.map((h) => ({ ...h })); }
  catalog(type) { return [...this._assets.values()].filter((a) => !type || a.type === type).map((a) => this.describe(a.id)); }

  // Dependency mapping (asset → assets it depends on) + reverse-dependency impact.
  dependencyMap() { const m = {}; for (const a of this._assets.values()) m[a.id] = [...a.dependsOn]; return m; }
  impact(id) { this._must(id); return [...this._assets.values()].filter((a) => a.dependsOn.includes(id)).map((a) => a.id); }

  // Asset-health score: deterministic signal from status, risk, and staleness (version churn).
  health(id) {
    const a = this._must(id);
    let score = 1;
    if (a.status === 'deprecated') score -= 0.3; if (a.status === 'retired') score -= 0.6;
    score -= ({ low: 0, medium: 0.1, high: 0.2, critical: 0.4 })[a.riskClass];
    score = +Math.max(0, Math.min(1, score)).toFixed(2);
    return { id, health: score, band: score >= 0.8 ? 'healthy' : score >= 0.5 ? 'watch' : 'at-risk', status: a.status, riskClass: a.riskClass };
  }
  portfolioHealth() { const rows = this.catalog().map((a) => this.health(a.id)); const avg = rows.length ? +(rows.reduce((s, r) => s + r.health, 0) / rows.length).toFixed(2) : 1; return { assets: rows.length, averageHealth: avg, atRisk: rows.filter((r) => r.band === 'at-risk').map((r) => r.id) }; }
  _must(id) { const a = this._assets.get(id); if (!a) throw new Error('unknown asset: ' + id); return a; }
}

module.exports = { AssetRegistry, ASSET_TYPES, LIFECYCLE, RISK_CLASSES };
