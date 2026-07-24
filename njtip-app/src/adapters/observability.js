'use strict';
// Structured observability: JSON logging (PII-redacting), metrics registry, health,
// and request tracing. Privacy-by-design: identity/PII keys are NEVER logged, and the
// intake path emits only aggregate signals (blueprint phase7/07). Zero dependencies.
const crypto = require('node:crypto');

const PII_KEYS = new Set(['name', 'email', 'phone', 'ip', 'ipaddress', 'omang', 'nationalid', 'content', 'authorization', 'token', 'password']);
const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function redact(obj) {
  if (obj == null || typeof obj !== 'object') return obj;
  const out = Array.isArray(obj) ? [] : {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = PII_KEYS.has(k.toLowerCase()) ? '***REDACTED***' : (typeof v === 'object' ? redact(v) : v);
  }
  return out;
}

class Metrics {
  constructor() { this._counters = new Map(); this._hist = new Map(); }
  inc(name, labels = {}, n = 1) { const k = key(name, labels); this._counters.set(k, (this._counters.get(k) || 0) + n); }
  observe(name, ms) { const a = this._hist.get(name) || []; a.push(ms); this._hist.set(name, a); }
  snapshot() {
    const counters = Object.fromEntries(this._counters);
    const histograms = {};
    for (const [n, a] of this._hist) { const s = [...a].sort((x, y) => x - y); histograms[n] = { count: a.length, p50: pctl(s, 50), p95: pctl(s, 95), max: s[s.length - 1] || 0 }; }
    return { counters, histograms };
  }
  // Prometheus-style text exposition.
  prometheus() {
    const lines = [];
    for (const [k, v] of this._counters) lines.push(`${k} ${v}`);
    for (const [n, a] of this._hist) { const s = [...a].sort((x, y) => x - y); lines.push(`${n}_p95 ${pctl(s, 95)}`); lines.push(`${n}_count ${a.length}`); }
    return lines.join('\n') + '\n';
  }
}
function key(name, labels) { const l = Object.entries(labels).map(([k, v]) => `${k}="${v}"`).join(','); return l ? `${name}{${l}}` : name; }
function pctl(sorted, p) { if (!sorted.length) return 0; return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]; }

class Logger {
  constructor(level = 'info', sink = console) { this._level = LEVELS[level] ?? 2; this._sink = sink; }
  _log(lvl, msg, fields) {
    if (LEVELS[lvl] > this._level) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level: lvl, msg, ...redact(fields || {}) });
    (lvl === 'error' ? this._sink.error : this._sink.log).call(this._sink, line);
  }
  error(m, f) { this._log('error', m, f); }
  warn(m, f) { this._log('warn', m, f); }
  info(m, f) { this._log('info', m, f); }
  debug(m, f) { this._log('debug', m, f); }
}

function newTraceId() { return crypto.randomBytes(8).toString('hex'); }

class Health {
  constructor() { this._checks = new Map(); this.startedAt = Date.now(); }
  register(name, fn) { this._checks.set(name, fn); }
  snapshot() {
    const checks = {};
    let ok = true;
    for (const [n, fn] of this._checks) { try { const r = fn(); checks[n] = r ? 'ok' : 'fail'; if (!r) ok = false; } catch (_) { checks[n] = 'fail'; ok = false; } }
    return { status: ok ? 'healthy' : 'unhealthy', uptimeMs: Date.now() - this.startedAt, checks };
  }
}

module.exports = { Logger, Metrics, Health, redact, newTraceId, PII_KEYS };
