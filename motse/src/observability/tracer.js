'use strict';

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');

/**
 * Distributed tracing (Phase 2 observability) — an OpenTelemetry-compatible,
 * dependency-free tracer. Spans carry a W3C-format trace id and span id,
 * nest via AsyncLocalStorage context propagation (correct across async
 * boundaries), and are kept in a bounded ring buffer for introspection and
 * export. A real OpenTelemetry SDK can be bridged in later behind the same
 * `startSpan/withSpan` surface (mirrors the KV in-memory/Redis pattern);
 * until then this produces per-request traces spanning the execution path.
 *
 * Additive: nothing depends on the tracer; instrumented call sites use it
 * only when one is provided, so the platform runs identically without it.
 */
class Tracer {
  constructor({ clock, maxSpans = 2000, sink = null } = {}) {
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.maxSpans = maxSpans;
    this.sink = sink; // optional exporter (e.g. an OTel bridge): (span) => void
    this.als = new AsyncLocalStorage();
    this.spans = []; // completed spans (ring buffer)
  }

  /** The active { traceId, spanId } context, if any. */
  currentContext() {
    return this.als.getStore() || null;
  }

  /**
   * Start a span. Parent is taken from an explicit option, else the active
   * context. Returns a handle with end()/setAttribute()/addEvent().
   */
  startSpan(name, { attributes = {}, traceId = null, parent = null } = {}) {
    const ctx = parent || this.currentContext();
    const span = {
      trace_id: traceId || (ctx && ctx.traceId) || genTraceId(),
      span_id: genSpanId(),
      parent_id: ctx ? ctx.spanId : null,
      name,
      attributes: { ...attributes },
      events: [],
      status: 'ok',
      start_ms: this.clock.nowMs(),
      started_at: this.clock.nowIso(),
      end_ms: null,
      duration_ms: null,
    };
    span.setAttribute = (k, v) => { span.attributes[k] = v; return span; };
    span.addEvent = (n, attrs = {}) => { span.events.push({ name: n, at: this.clock.nowIso(), attrs }); return span; };
    span.end = (opts = {}) => {
      if (span.end_ms != null) return span; // idempotent
      span.end_ms = this.clock.nowMs();
      span.duration_ms = span.end_ms - span.start_ms;
      if (opts.error) {
        span.status = 'error';
        span.attributes.error = String(opts.error.message || opts.error);
      }
      this._record(span);
      return span;
    };
    return span;
  }

  /**
   * Run `fn` with a fresh span as the active context, ending it
   * automatically (recording thrown/rejected errors). Works for sync and
   * async `fn`.
   */
  withSpan(name, fn, opts = {}) {
    const span = this.startSpan(name, opts);
    return this.als.run({ traceId: span.trace_id, spanId: span.span_id }, () => {
      try {
        const result = fn(span);
        if (result && typeof result.then === 'function') {
          return result.then(
            (v) => { span.end(); return v; },
            (e) => { span.end({ error: e }); throw e; }
          );
        }
        span.end();
        return result;
      } catch (e) {
        span.end({ error: e });
        throw e;
      }
    });
  }

  /** Bind an explicit context for a continuation (used by HTTP middleware). */
  runInContext(ctx, fn) {
    return this.als.run(ctx, fn);
  }

  /** Set the active context for the current async scope and its descendants. */
  enter(ctx) {
    this.als.enterWith(ctx);
  }

  _record(span) {
    const stored = { ...span };
    delete stored.setAttribute; delete stored.addEvent; delete stored.end;
    this.spans.push(stored);
    if (this.spans.length > this.maxSpans) this.spans.shift();
    if (this.sink) {
      try { this.sink(stored); } catch (e) { /* an exporter must never break the request */ }
    }
  }

  /** All spans for a trace, in start order. */
  trace(traceId) {
    return this.spans.filter((s) => s.trace_id === traceId).sort((a, b) => a.start_ms - b.start_ms);
  }

  /** The most recent distinct traces (newest first), summarised. */
  recent(limit = 20) {
    const byTrace = new Map();
    for (const s of this.spans) {
      if (!byTrace.has(s.trace_id)) byTrace.set(s.trace_id, []);
      byTrace.get(s.trace_id).push(s);
    }
    const traces = [...byTrace.entries()].map(([traceId, spans]) => {
      // A grouped trace always has ≥1 span; prefer the parentless root, else
      // the earliest recorded span (a trace whose root lives in another service).
      const root = spans.find((s) => s.parent_id == null) || spans[0];
      return {
        trace_id: traceId,
        root: root.name,
        spans: spans.length,
        duration_ms: root.duration_ms,
        status: spans.some((s) => s.status === 'error') ? 'error' : 'ok',
        started_at: root.started_at,
      };
    });
    return traces.sort((a, b) => String(b.started_at).localeCompare(String(a.started_at))).slice(0, limit);
  }

  stats() {
    return { spans: this.spans.length, max_spans: this.maxSpans, traces: new Set(this.spans.map((s) => s.trace_id)).size };
  }

  // ── W3C trace-context propagation ───────────────────────────────────

  static formatTraceparent(traceId, spanId) {
    return `00-${traceId}-${spanId}-01`;
  }

  static parseTraceparent(header) {
    const parts = String(header || '').split('-');
    if (parts.length !== 4 || parts[0] !== '00') return null;
    return { traceId: parts[1], spanId: parts[2], flags: parts[3] };
  }
}

function genTraceId() {
  return crypto.randomBytes(16).toString('hex');
}

function genSpanId() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = { Tracer };
