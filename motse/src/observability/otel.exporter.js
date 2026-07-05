'use strict';

/**
 * OTLP span exporter (Phase A — operationalize observability). Bridges the
 * in-process Tracer to any OpenTelemetry-compatible backend (Jaeger, Grafana
 * Tempo, an OTel Collector) by formatting finished spans as OTLP/JSON
 * `resourceSpans` and POSTing them to an OTLP/HTTP endpoint.
 *
 * Additive and OFF by default: with no endpoint (and no injected transport)
 * `accept()` is a no-op, so the tracer sink does nothing and behaviour is
 * identical to before. It turns on purely by configuration:
 *   OTEL_EXPORTER_OTLP_ENDPOINT   e.g. http://tempo:4318 or http://jaeger:4318
 *   OTEL_SERVICE_NAME             defaults to "motse-core"
 *
 * Spans are buffered and flushed in batches; a flush failure NEVER propagates
 * into the request path (it is counted as dropped). The wire transport is
 * injectable so it is fully testable without a network.
 */
class OtelSpanExporter {
  constructor({
    endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || null,
    serviceName = process.env.OTEL_SERVICE_NAME || 'motse-core',
    transport = null,
    batchSize = 128,
    clock,
  } = {}) {
    this.endpoint = endpoint;
    this.serviceName = serviceName;
    this.transport = transport; // (payload, endpoint) => void | Promise; else the default HTTP transport
    this.batchSize = batchSize;
    this.clock = clock || { nowMs: () => Date.now() };
    this.buffer = [];
    this.exported = 0;
    this.dropped = 0;
    this.flushes = 0;
  }

  /** Whether export is active (an endpoint or an injected transport exists). */
  get enabled() {
    return !!(this.endpoint || this.transport);
  }

  /**
   * Tracer sink: called with each finished span. Buffers and auto-flushes on
   * a full batch. No-op (and cheap) when export is disabled.
   */
  accept(span) {
    if (!this.enabled) return;
    this.buffer.push(span);
    if (this.buffer.length >= this.batchSize) this.flush();
  }

  /** Serialize + ship the buffered spans. Returns the OTLP payload (or null). */
  flush() {
    if (this.buffer.length === 0) return null;
    const spans = this.buffer.splice(0, this.buffer.length);
    const payload = this.toOtlp(spans);
    this.flushes += 1;
    try {
      const send = this.transport || defaultOtlpTransport;
      send(payload, this.endpoint);
      this.exported += spans.length;
    } catch (e) {
      // Telemetry export must never break or slow the request path.
      this.dropped += spans.length;
    }
    return payload;
  }

  /** OTLP/JSON trace payload (spec: opentelemetry-proto trace v1). */
  toOtlp(spans) {
    return {
      resourceSpans: [
        {
          resource: { attributes: [attr('service.name', this.serviceName)] },
          scopeSpans: [
            {
              scope: { name: 'motse.tracer', version: '1.0.0' },
              spans: spans.map((s) => this.toOtlpSpan(s)),
            },
          ],
        },
      ],
    };
  }

  toOtlpSpan(s) {
    return {
      traceId: s.trace_id,
      spanId: s.span_id,
      parentSpanId: s.parent_id || '',
      name: s.name,
      kind: 1, // SPAN_KIND_INTERNAL
      startTimeUnixNano: msToNano(s.start_ms),
      endTimeUnixNano: msToNano(s.end_ms != null ? s.end_ms : s.start_ms),
      attributes: Object.entries(s.attributes || {}).map(([k, v]) => attr(k, v)),
      events: (s.events || []).map((e) => ({
        name: e.name,
        timeUnixNano: isoToNano(e.at),
        attributes: Object.entries(e.attrs || {}).map(([k, v]) => attr(k, v)),
      })),
      status: { code: s.status === 'error' ? 2 : 1 }, // ERROR : OK
    };
  }

  stats() {
    return {
      enabled: this.enabled,
      endpoint: this.endpoint,
      service_name: this.serviceName,
      buffered: this.buffer.length,
      exported: this.exported,
      dropped: this.dropped,
      flushes: this.flushes,
    };
  }
}

// ── OTLP/JSON encoding helpers ────────────────────────────────────────
function attr(key, value) {
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { key, value: { intValue: value } }
      : { key, value: { doubleValue: value } };
  }
  if (typeof value === 'boolean') return { key, value: { boolValue: value } };
  return { key, value: { stringValue: String(value) } };
}

function msToNano(ms) {
  // OTLP requires unix-nano; represent as a string to avoid 2^53 loss.
  return String(Math.round(Number(ms) || 0) * 1e6);
}

function isoToNano(iso) {
  const ms = Date.parse(iso);
  return String((Number.isNaN(ms) ? 0 : ms) * 1e6);
}

/* istanbul ignore next: real network transport, exercised only when an OTLP
   endpoint is configured (never in tests, which inject a transport). */
function defaultOtlpTransport(payload, endpoint) {
  if (!endpoint) return;
  const url = new URL('/v1/traces', endpoint);
  const lib = url.protocol === 'https:' ? require('https') : require('http');
  const body = Buffer.from(JSON.stringify(payload));
  const req = lib.request(
    url,
    { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': body.length } },
    (res) => { res.resume(); } // drain; we do not block on the response
  );
  req.on('error', () => {}); // fire-and-forget; failures are counted by flush()
  req.write(body);
  req.end();
}

module.exports = { OtelSpanExporter };
