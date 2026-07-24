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
  samples(name) { return [...(this._hist.get(name) || [])]; }
  counters() { return Object.fromEntries(this._counters); }
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
function newSpanId() { return crypto.randomBytes(8).toString('hex'); }

// Distributed tracing: spans with parent linkage + W3C-traceparent-style propagation, so a
// request can be correlated across services. Spans NEVER carry identity/content — only the
// operation name and non-identifying attributes (which are redacted on record, defence in
// depth). A bounded ring buffer keeps recent spans for inspection.
class Tracer {
  constructor({ clock = () => Date.now(), max = 1000 } = {}) { this._clock = clock; this._max = max; this._spans = []; }
  // Continue an incoming trace (traceparent header) or start a new one.
  startSpan(name, ctx = {}) {
    const traceId = ctx.traceId || parseTraceparent(ctx.traceparent).traceId || newTraceId();
    const parentId = ctx.parentId || parseTraceparent(ctx.traceparent).spanId || null;
    const span = { traceId, spanId: newSpanId(), parentId, name, start: this._clock(), attrs: redact(ctx.attrs || {}), _t: this };
    span.setAttr = (k, val) => { span.attrs[k] = redact({ [k]: val })[k]; return span; };
    span.end = (status = 'ok') => { span.durationMs = this._clock() - span.start; span.status = status; this._record(span); return span; };
    span.traceparent = () => formatTraceparent(traceId, span.spanId);
    return span;
  }
  _record(span) { this._spans.push({ traceId: span.traceId, spanId: span.spanId, parentId: span.parentId, name: span.name, durationMs: span.durationMs, status: span.status, attrs: span.attrs }); if (this._spans.length > this._max) this._spans.shift(); }
  recent(limit = 50) { return this._spans.slice(-limit); }
  forTrace(traceId) { return this._spans.filter((s) => s.traceId === traceId); }
}

// W3C traceparent: version(2)-traceId(32)-spanId(16)-flags(2). Reference parse/format
// (32/16 hex not enforced strictly; we only need correlation continuity).
function parseTraceparent(tp) {
  if (!tp || typeof tp !== 'string') return {};
  const parts = tp.split('-'); if (parts.length < 3) return {};
  return { traceId: parts[1], spanId: parts[2] };
}
function formatTraceparent(traceId, spanId) { return `00-${traceId}-${spanId}-01`; }

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

module.exports = { Logger, Metrics, Health, Tracer, redact, newTraceId, newSpanId, parseTraceparent, formatTraceparent, PII_KEYS };
