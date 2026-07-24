'use strict';
// Enterprise API Governance (Phase 37). An API registry seeded from the live OpenAPI spec,
// with version management, contract validation, lifecycle + deprecation policies, a consumer
// registry, per-consumer RATE LIMITING (token bucket), quality metrics, certification, and a
// governance dashboard. Deterministic. Backward compatibility is a first-class concern.
class ApiRegistry {
  constructor({ clock = () => Date.now() } = {}) { this._clock = clock; this._apis = new Map(); this._consumers = new Map(); }

  // Seed from an OpenAPI spec (the platform's own contract) — every documented operation
  // becomes a governed API entry (status active by default).
  fromOpenApi(spec) {
    for (const [path, ops] of Object.entries(spec.paths || {})) {
      for (const [method, op] of Object.entries(ops)) {
        const key = `${method.toUpperCase()} ${path}`;
        this._apis.set(key, { method: method.toUpperCase(), path, operationId: op.operationId || null, version: (spec.info && spec.info.version) || '1', status: 'active', deprecatedIn: null, sunsetAt: null });
      }
    }
    return this._apis.size;
  }
  register(method, path, { operationId, version = '1', status = 'active' } = {}) { const key = `${method.toUpperCase()} ${path}`; this._apis.set(key, { method: method.toUpperCase(), path, operationId, version, status, deprecatedIn: null, sunsetAt: null }); return key; }
  get(method, path) { return this._apis.get(`${method.toUpperCase()} ${path}`) || null; }
  list() { return [...this._apis.values()]; }

  // Contract validation: is this exact operation part of the governed contract? Fail-closed.
  validate(method, path) { const a = this.get(method, path); return { ok: !!a && a.status !== 'retired', status: a ? a.status : 'unknown' }; }

  // Lifecycle: active → deprecated (with a sunset window) → retired.
  deprecate(method, path, { sunsetAt } = {}) { const a = this._must(method, path); a.status = 'deprecated'; a.deprecatedIn = this._clock(); a.sunsetAt = sunsetAt || null; return { ...a }; }
  retire(method, path) { const a = this._must(method, path); if (a.status !== 'deprecated') throw new Error('an API must be deprecated before retirement'); a.status = 'retired'; return { ...a }; }

  // Certification: an operation is certified only if it is governed AND documented (its
  // operationId is present) — a lightweight contract/quality gate.
  certify(method, path) { const a = this._must(method, path); const certified = a.status === 'active' && !!a.operationId; return { method, path, certified, reason: certified ? 'active + documented operationId' : 'missing operationId or not active' }; }

  // Consumer registry + per-consumer token-bucket RATE LIMITING.
  registerConsumer(name, { tier = 'standard', ratePerMin = 60, burst = 10 } = {}) { this._consumers.set(name, { name, tier, ratePerMin, tokens: burst, burst, lastRefill: this._clock() }); return name; }
  allow(name) {
    const c = this._consumers.get(name); if (!c) return { allowed: false, reason: 'unregistered consumer' };
    const now = this._clock(); const refill = ((now - c.lastRefill) / 60_000) * c.ratePerMin;
    c.tokens = Math.min(c.burst, c.tokens + refill); c.lastRefill = now;
    if (c.tokens >= 1) { c.tokens -= 1; return { allowed: true, remaining: Math.floor(c.tokens) }; }
    return { allowed: false, reason: 'rate limit exceeded', retryAfterMs: Math.ceil((1 - c.tokens) / c.ratePerMin * 60_000) };
  }

  // Quality metrics + governance dashboard.
  qualityMetrics() { const all = this.list(); const documented = all.filter((a) => a.operationId).length; return { total: all.length, documented, documentedPct: all.length ? +(documented / all.length).toFixed(2) : 0, deprecated: all.filter((a) => a.status === 'deprecated').length, retired: all.filter((a) => a.status === 'retired').length }; }
  dashboard() { return { metrics: this.qualityMetrics(), consumers: this._consumers.size, byStatus: this.list().reduce((m, a) => ((m[a.status] = (m[a.status] || 0) + 1), m), {}) }; }
  _must(method, path) { const a = this.get(method, path); if (!a) throw new Error(`unknown API: ${method} ${path}`); return a; }
}

module.exports = { ApiRegistry };
