'use strict';

/**
 * Phase A — Operationalize observability. Verifies the export/logging bridges
 * and the operational config that turns emitted signals into dashboards and
 * alerts:
 *
 *   1. OtelSpanExporter — OFF by default; when configured, formats finished
 *      spans into OTLP/JSON and ships them via an injectable transport, never
 *      breaking the request path.
 *   2. Structured-log enrichment — the Logger auto-attaches the active trace
 *      context (and a bound service name) to every line.
 *   3. Config integrity — the checked-in Grafana dashboards and Prometheus
 *      alert rules reference metric names the platform actually emits.
 *   4. Container/HTTP wiring — platform.otel present & disabled by default,
 *      logs correlate to the request trace, admin routes work.
 */
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const request = require('supertest');
const { OtelSpanExporter } = require('../src/observability/otel.exporter');
const { Tracer } = require('../src/observability/tracer');
const { Logger } = require('../src/monitoring/logger');
const { Clock } = require('../src/kernel/clock');
const { createApp } = require('../src/app');
const { createPlatform } = require('../src/container');
const { world } = require('./helpers');

const DEPLOY = path.join(__dirname, '../../deploy/motse/observability');

function tracedExporter(opts = {}) {
  const exporter = new OtelSpanExporter(opts);
  const tracer = new Tracer({ sink: (s) => exporter.accept(s) });
  return { exporter, tracer };
}

describe('OtelSpanExporter — OFF by default', () => {
  test('unconfigured exporter is disabled and accept() is a pure no-op', () => {
    const { exporter, tracer } = tracedExporter(); // no endpoint, no transport
    expect(exporter.enabled).toBe(false);
    tracer.withSpan('unexported', () => {});
    expect(exporter.buffer).toHaveLength(0);
    expect(exporter.flush()).toBeNull();
    expect(exporter.stats()).toMatchObject({ enabled: false, exported: 0, dropped: 0 });
  });

  test('an endpoint alone enables export', () => {
    const exporter = new OtelSpanExporter({ endpoint: 'http://tempo:4318' });
    expect(exporter.enabled).toBe(true);
    expect(exporter.stats().endpoint).toBe('http://tempo:4318');
  });
});

describe('OtelSpanExporter — OTLP formatting & delivery', () => {
  test('spans are batched and shipped as OTLP/JSON via the injected transport', () => {
    const sent = [];
    const { exporter, tracer } = tracedExporter({ transport: (p) => sent.push(p), serviceName: 'motse-test' });
    tracer.withSpan('parent', (parent) => {
      parent.setAttribute('count', 5); // int
      parent.setAttribute('ratio', 1.5); // double
      parent.setAttribute('ok', true); // bool
      parent.setAttribute('label', 'x'); // string
      parent.addEvent('checkpoint', { k: 'v' });
      tracer.withSpan('child', () => {});
    });
    exporter.flush();
    expect(sent).toHaveLength(1);
    const rs = sent[0].resourceSpans[0];
    expect(rs.resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'motse-test' } });
    const spans = rs.scopeSpans[0].spans;
    expect(spans).toHaveLength(2);
    const parent = spans.find((s) => s.name === 'parent');
    const child = spans.find((s) => s.name === 'child');
    // W3C ids preserved; parent linkage intact.
    expect(parent.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(parent.status).toEqual({ code: 1 }); // OK
    // Attribute type encoding.
    const byKey = Object.fromEntries(parent.attributes.map((a) => [a.key, a.value]));
    expect(byKey.count).toEqual({ intValue: 5 });
    expect(byKey.ratio).toEqual({ doubleValue: 1.5 });
    expect(byKey.ok).toEqual({ boolValue: true });
    expect(byKey.label).toEqual({ stringValue: 'x' });
    // Event carried across with a unix-nano timestamp.
    expect(parent.events[0]).toMatchObject({ name: 'checkpoint' });
    expect(parent.events[0].timeUnixNano).toMatch(/^\d+$/);
    expect(parent.startTimeUnixNano).toMatch(/^\d+$/);
  });

  test('error spans map to OTLP status code 2', () => {
    const sent = [];
    const { exporter, tracer } = tracedExporter({ transport: (p) => sent.push(p) });
    expect(() => tracer.withSpan('boom', () => { throw new Error('x'); })).toThrow('x');
    exporter.flush();
    expect(sent[0].resourceSpans[0].scopeSpans[0].spans[0].status).toEqual({ code: 2 });
  });

  test('auto-flush triggers on a full batch', () => {
    let flushes = 0;
    const exporter = new OtelSpanExporter({ transport: () => { flushes += 1; }, batchSize: 3, clock: new Clock() });
    const tracer = new Tracer({ sink: (s) => exporter.accept(s) });
    for (let i = 0; i < 7; i += 1) tracer.startSpan(`s${i}`).end();
    expect(flushes).toBe(2); // two full batches of 3; one span left buffered
    expect(exporter.buffer).toHaveLength(1);
    expect(exporter.exported).toBe(6);
  });

  test('a transport failure is counted as dropped and never propagates', () => {
    const { exporter, tracer } = tracedExporter({ transport: () => { throw new Error('collector down'); } });
    tracer.startSpan('s').end();
    expect(() => exporter.flush()).not.toThrow();
    expect(exporter.dropped).toBe(1);
    expect(exporter.exported).toBe(0);
    expect(exporter.stats().flushes).toBe(1);
  });

  test('toOtlp tolerates a minimal span (no attributes/events/end) and bad timestamps', () => {
    const exporter = new OtelSpanExporter(); // no-arg constructor path
    const payload = exporter.toOtlp([
      {
        trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), parent_id: null,
        name: 'minimal', status: 'ok', start_ms: 5, end_ms: null,
        // attributes/events intentionally omitted → || {} / || [] defaults
        events: [{ name: 'e', at: 'not-a-date' }], // isoToNano NaN guard + attrs || {}
      },
    ]);
    const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
    expect(span.parentSpanId).toBe(''); // parent_id || ''
    expect(span.attributes).toEqual([]);
    expect(span.endTimeUnixNano).toBe(span.startTimeUnixNano); // end fell back to start
    expect(span.events[0].timeUnixNano).toBe('0'); // unparseable date → 0
    expect(span.events[0].attributes).toEqual([]);
  });

  test('falls back to the default HTTP transport when none is injected', () => {
    // Unreachable endpoint: the default transport fires-and-forgets, the socket
    // error is swallowed async, and flush() returns synchronously (no hang).
    const exporter = new OtelSpanExporter({ endpoint: 'http://127.0.0.1:1' });
    exporter.buffer.push({ trace_id: 't', span_id: 's', name: 'n', status: 'ok', start_ms: 1, end_ms: 2 });
    expect(() => exporter.flush()).not.toThrow();
    expect(exporter.exported).toBe(1);
  });
});

describe('Structured-log enrichment', () => {
  // The test harness sets MOTSE_LOG_LEVEL=silent; force a live level so lines emit.
  function capture() {
    const lines = [];
    return { lines, sink: (l) => lines.push(JSON.parse(l)), level: 'debug' };
  }

  test('a context provider attaches dynamic fields at log time', () => {
    const { lines, sink, level } = capture();
    let ctx = { trace_id: 't1', span_id: 's1' };
    const log = new Logger({ clock: new Clock(), sink, level, context: () => ctx });
    log.info('first');
    ctx = { trace_id: 't2', span_id: 's2' };
    log.info('second');
    expect(lines[0]).toMatchObject({ message: 'first', trace_id: 't1' });
    expect(lines[1]).toMatchObject({ message: 'second', trace_id: 't2' });
  });

  test('precedence: explicit fields > bound > dynamic context', () => {
    const { lines, sink, level } = capture();
    const log = new Logger({ clock: new Clock(), sink, level, context: () => ({ scope: 'ctx', trace_id: 'ctx' }) })
      .with({ scope: 'bound', service: 'motse-core' });
    log.info('m', { scope: 'explicit' });
    expect(lines[0]).toMatchObject({ scope: 'explicit', service: 'motse-core', trace_id: 'ctx' });
  });

  test('with() propagates the context provider to child loggers', () => {
    const { lines, sink, level } = capture();
    const child = new Logger({ clock: new Clock(), sink, level, context: () => ({ trace_id: 'x' }) }).with({ module: 'm' });
    child.info('hi');
    expect(lines[0]).toMatchObject({ module: 'm', trace_id: 'x' });
  });

  test('a throwing context provider never breaks a log line', () => {
    const { lines, sink, level } = capture();
    const log = new Logger({ clock: new Clock(), sink, level, context: () => { throw new Error('ctx fail'); } });
    expect(() => log.info('still logs')).not.toThrow();
    expect(lines[0].message).toBe('still logs');
  });

  test('no context provider → behaviour unchanged (backward compatible)', () => {
    const { lines, sink, level } = capture();
    const log = new Logger({ clock: new Clock(), sink, level });
    log.info('plain', { a: 1 });
    expect(lines[0]).toMatchObject({ level: 'info', message: 'plain', a: 1 });
    expect(lines[0].trace_id).toBeUndefined();
  });
});

describe('Operational config integrity', () => {
  // The set of Foundation/Phase-2 metric base-names the platform emits and the
  // dashboards/alerts depend on. Infra series (container_cpu_*) come from
  // node-exporter/cAdvisor and are intentionally excluded from this check.
  const EMITTED = [
    'foundation_transaction_total', 'foundation_transaction_ms',
    'foundation_outbox_published_total', 'foundation_outbox_retried_total', 'foundation_outbox_dead_total',
    'foundation_outbox_publish_ms',
    'foundation_idempotency_total', 'foundation_ratelimit_total', 'foundation_lock_total',
    'motse_outbox_pending', 'motse_outbox_dead', 'motse_distributed_redis_backed',
    'motse_http_requests_total', 'motse_http_request_duration_ms', 'motse_ledger_trial_balance_minor',
    'motse_ratelimit_adaptive_total',
  ];

  // Prometheus histogram series render as base_bucket/_sum/_count; normalise
  // a referenced token back to its metric base name before membership checks.
  const baseName = (t) => t.replace(/_(bucket|sum|count)$/, '');

  test('the platform actually renders every metric the Foundation dashboards/alerts reference', async () => {
    const platform = createPlatform();
    // Exercise the Foundation so counters (not just gauges) exist in the registry.
    platform.store.transaction(() => platform.store.collection('probe').insert({ id: 'p' }));
    await platform.distributed.idempotency.runOnce('k', () => 1);
    await platform.distributed.rateLimiter.take('id');
    await platform.distributed.lock.withLock('r', async () => {});
    // Drive the transactional outbox through publish → retry → dead-letter so
    // all three outbox counters + the publish-latency histogram are present.
    platform.bus.register('probe.ok', 1, ['n']);
    platform.bus.register('probe.bad', 1, ['n']);
    platform.bus.subscribe('probe.bad', 'boom', () => { throw new Error('down'); });
    platform.outbox.maxAttempts = 2;
    platform.outbox.run(({ stage }) => stage('probe.ok', { n: 1 })); // published + publish_ms
    platform.outbox.run(({ stage }) => stage('probe.bad', { n: 1 })); // attempt 1 → retried
    platform.outbox.drain(); // attempt 2 → dead-lettered
    // HTTP requests so the RED middleware + adaptive limiter series render too.
    const { app } = createApp(platform);
    await request(app).get('/health/live');
    await request(app).get('/v1/kgetsi/campaigns');
    const text = platform.metrics.render();
    for (const name of EMITTED) {
      expect(text.includes(name)).toBe(true);
    }
  });

  test('the Foundation dashboards parse and reference only emitted app metrics', () => {
    for (const key of ['foundation', 'outbox', 'distributed', 'ratelimit']) {
      const dash = JSON.parse(fs.readFileSync(path.join(DEPLOY, 'dashboards', `${key}.json`), 'utf8'));
      expect(dash.uid).toBe(`motse-${key}`);
      const exprs = dash.panels.map((p) => p.targets[0].expr).join(' ');
      // Every metric token that looks like ours must be in the emitted set.
      const tokens = exprs.match(/\b(foundation|motse)_[a-z_]+/g) || [];
      expect(tokens.length).toBeGreaterThan(0);
      for (const token of tokens) expect(EMITTED).toContain(baseName(token));
    }
  });

  test('the Prometheus alert rules parse and the Foundation group references emitted metrics', () => {
    const doc = yaml.load(fs.readFileSync(path.join(DEPLOY, 'prometheus-alerts.yaml'), 'utf8'));
    const group = doc.groups.find((g) => g.name === 'motse-foundation');
    expect(group).toBeTruthy();
    const alertNames = group.rules.map((r) => r.alert);
    expect(alertNames).toEqual(
      expect.arrayContaining([
        'TransactionFailureSpike', 'OutboxBacklogGrowing', 'OutboxDeadLetterAccumulation',
        'LockContentionHigh', 'RateLimitSaturation',
      ])
    );
    const exprs = group.rules.map((r) => r.expr).join(' ');
    const tokens = exprs.match(/\b(foundation|motse)_[a-z_]+/g) || [];
    for (const token of tokens) expect(EMITTED).toContain(baseName(token));
    // Every rule carries a severity and a summary.
    for (const rule of group.rules) {
      expect(rule.labels.severity).toMatch(/^sev[123]$/);
      expect(rule.annotations.summary).toBeTruthy();
    }
  });
});

describe('Container & HTTP wiring', () => {
  function session(w, msisdn = '+26771000002', deviceId = 'dev-kabo') {
    const otp = w.p.identity.requestOtp(msisdn);
    const { session: s } = w.p.identity.verifyOtp(msisdn, otp.sandbox_code, { deviceId });
    return (r) => r.set('Authorization', `Bearer ${s.access_token}`).set('X-Device-Id', deviceId);
  }

  test('platform.otel is wired and disabled by default', () => {
    const platform = createPlatform();
    expect(platform.otel).toBeTruthy();
    expect(platform.otel.enabled).toBe(false);
  });

  test('request logs are auto-correlated to the request trace id', async () => {
    const platform = createPlatform();
    const lines = [];
    platform.logger.sink = (l) => lines.push(JSON.parse(l));
    platform.logger.threshold = 0; // harness sets MOTSE_LOG_LEVEL=silent; allow lines
    const { app } = createApp(platform);
    const traceId = 'a'.repeat(32);
    await request(app).get('/health/live').set('traceparent', `00-${traceId}-${'b'.repeat(16)}-01`);
    const httpLog = lines.find((l) => l.message === 'http');
    expect(httpLog).toBeTruthy();
    expect(httpLog.trace_id).toBe(traceId);
    expect(httpLog.service).toBe('motse-core');
  });

  test('admin OTLP routes report status and flush', async () => {
    const w = world();
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    const { app } = createApp(w.p);
    const authed = session(w);
    const status = await authed(request(app).get('/v1/admin/observability/otel'));
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ enabled: false, service_name: 'motse-core' });
    const flushed = await authed(request(app).post('/v1/admin/observability/otel/flush')).set('Idempotency-Key', 'otel-flush-1');
    expect(flushed.status).toBe(200);
    expect(flushed.body).toHaveProperty('flushed');
  });
});
