'use strict';

/**
 * Production validation harness (Phases 1–2: observability validation +
 * reliability engineering). Runs the REAL platform — the same container and
 * Express app that serve production — under production-shaped conditions and
 * validates empirically that the telemetry tells the truth:
 *
 *   traces complete & propagate · logs correlate · metrics match reality ·
 *   alerts fire only when they should · instrumentation overhead is bounded ·
 *   the Foundation recovers from injected faults (outage/blip/restart).
 *
 * Every scenario records expected-vs-observed checks; the run fails (exit 1)
 * if any check fails. Evidence is written to docs/evidence/ as JSON — the
 * measured basis for the SLO thresholds in deploy/motse/observability/slo.yaml.
 *
 *   node motse/scripts/production-validation.js [--smoke]
 *   --smoke: CI-sized run (seconds, not minutes); identical checks.
 */
process.env.MOTSE_LOG_LEVEL = 'info'; // we validate log output — do not silence it
const fs = require('fs');
const path = require('path');
const http = require('http');
const { performance } = require('perf_hooks');

const { createPlatform } = require('../src/container');
const { createApp } = require('../src/app');
const { Store } = require('../src/kernel/store');
const { Clock } = require('../src/kernel/clock');
const { EventBus } = require('../src/kernel/eventBus');
const { OutboxService } = require('../src/persistence/outbox');
const { Tracer } = require('../src/observability/tracer');
const { OtelSpanExporter } = require('../src/observability/otel.exporter');
const { Metrics } = require('../src/monitoring/metrics');
const { ChaosKv } = require('../src/distributed/chaos.kv');
const { InMemoryKvAdapter } = require('../src/distributed/kv');

const SMOKE = process.argv.includes('--smoke');
const CFG = SMOKE
  ? { loadSeconds: 2, workers: 8, txns: 2000, backlog: 1100, dlq: 30, locks: 60, rlBurst: 900, spans: 5000 }
  : { loadSeconds: 6, workers: 24, txns: 20000, backlog: 1100, dlq: 50, locks: 200, rlBurst: 2000, spans: 20000 };

// ── report plumbing ──────────────────────────────────────────────────
const report = {
  mode: SMOKE ? 'smoke' : 'full',
  started_at: new Date().toISOString(),
  node: process.version,
  scenarios: {},
  checks: [],
  alert_evaluation: [],
  recommendations: [],
};

function check(name, expected, observed, pass) {
  report.checks.push({ name, expected: String(expected), observed: String(observed), pass });
  // eslint-disable-next-line no-console
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}  (expected ${expected}, observed ${observed})`);
  return pass;
}

function pct(sorted, q) {
  return sorted.length ? sorted[Math.min(Math.floor(sorted.length * q), sorted.length - 1)] : 0;
}

function section(title) {
  // eslint-disable-next-line no-console
  console.log(`\n── ${title} ──`);
}

// Alert conditions mirrored from deploy/motse/observability/prometheus-alerts.yaml
// (semantic evaluation over the same signals PromQL would read).
function evaluateAlerts(platform, window) {
  const m = platform.metrics;
  const ratio = (num, den) => (den > 0 ? num / den : 0);
  const txTotal = m.counterTotal('foundation_transaction_total') - window.tx0;
  const txRb = m.counterValue('foundation_transaction_total', { result: 'rollback' }) - window.rb0;
  const lockTotal = m.counterTotal('foundation_lock_total') - window.lock0;
  const lockCont = m.counterValue('foundation_lock_total', { result: 'contended' }) - window.cont0;
  const rlTotal = m.counterTotal('foundation_ratelimit_total') - window.rl0;
  const rlLim = m.counterValue('foundation_ratelimit_total', { result: 'limited' }) - window.lim0;
  const stats = platform.outbox.stats();
  return {
    TransactionFailureSpike: ratio(txRb, txTotal) > 0.05,
    OutboxBacklogGrowing: stats.pending > 1000,
    OutboxDeadLetterAccumulation: stats.dead > 0,
    LockContentionHigh: ratio(lockCont, lockTotal) > 0.2,
    RateLimitSaturation: ratio(rlLim, rlTotal) > 0.5,
    LedgerImbalance: !platform.ledger.trialBalance().balanced,
  };
}

function snapshotWindow(platform) {
  const m = platform.metrics;
  return {
    tx0: m.counterTotal('foundation_transaction_total'),
    rb0: m.counterValue('foundation_transaction_total', { result: 'rollback' }),
    lock0: m.counterTotal('foundation_lock_total'),
    cont0: m.counterValue('foundation_lock_total', { result: 'contended' }),
    rl0: m.counterTotal('foundation_ratelimit_total'),
    lim0: m.counterValue('foundation_ratelimit_total', { result: 'limited' }),
  };
}

function recordAlertPhase(platform, phase, window, expectedFired) {
  const fired = evaluateAlerts(platform, window);
  for (const [alert, isFired] of Object.entries(fired)) {
    const expected = expectedFired.includes(alert);
    report.alert_evaluation.push({ phase, alert, expected, fired: isFired });
    check(`alert ${alert} @ ${phase}`, expected ? 'fires' : 'silent', isFired ? 'fires' : 'silent', isFired === expected);
  }
}

// ── boot the real platform with capturing sinks ──────────────────────
const logLines = [];
const platform = createPlatform({ logSink: (line) => logLines.push(JSON.parse(line)) });
const exported = [];
platform.otel.transport = (payload) => exported.push(payload); // in-memory OTLP collector
const { app } = createApp(platform);

function httpRequest(base, method, urlPath, { body = null, headers = {} } = {}) {
  return new Promise((resolve) => {
    const started = performance.now();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(`${base}${urlPath}`, { method, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, ms: performance.now() - started }));
    });
    req.on('error', () => resolve({ status: 0, headers: {}, ms: performance.now() - started }));
    if (payload) req.write(payload);
    req.end();
  });
}

async function main() {
  const server = http.createServer(app);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const heapStart = process.memoryUsage().heapUsed;

  // ════ W7 · End-to-end trace nesting over HTTP (admin outbox drain) ════
  // Runs BEFORE the sustained load: the /v1 rate limiter keys by client IP
  // ahead of authentication, so the load phase exhausts this host's bucket
  // for authenticated callers too (see recommendation below).
  section('W7 cross-boundary trace propagation');
  // The operator session is reused by W1's adaptive-rate-limit check.
  const { sandbox_code } = platform.identity.requestOtp('+26771009999');
  const { user: opsUser, session: opsSession } = platform.identity.verifyOtp('+26771009999', sandbox_code, { deviceId: 'validator' });
  platform.identity.grantInstitutional(opsUser.id, { institution: 'Validation' }, 'system:bootstrap');
  platform.identity.grantRole(opsUser.id, 'platform_admin', 'platform', 'system:bootstrap');
  {
    const traceId = 'ab'.repeat(16);
    const res = await httpRequest(base, 'POST', '/v1/admin/outbox/drain', {
      headers: {
        traceparent: `00-${traceId}-${'e'.repeat(16)}-01`,
        Authorization: `Bearer ${opsSession.access_token}`,
        'X-Device-Id': 'validator',
        'Idempotency-Key': 'validate-drain-1',
      },
    });
    const spans = platform.tracer.trace(traceId);
    const root = spans.find((sp) => sp.name === 'HTTP POST');
    const child = spans.find((sp) => sp.name === 'outbox.drain');
    check('admin drain returns 200 under trace', 200, res.status, res.status === 200);
    check('child span nests under the HTTP root (same trace, parent link)', 'root→child', root && child && child.parent_id === root.span_id ? 'root→child' : 'broken', !!(root && child && child.parent_id === root.span_id));
    check('response traceparent preserves the inbound trace id', traceId, (res.headers.traceparent || '').split('-')[1], (res.headers.traceparent || '').includes(traceId));
  }

  // ════ W2 · Duplicate requests (HTTP replay + distributed exactly-once) ════
  // Also pre-load: the /v1 bucket must have headroom for the replay check —
  // a 429 fires before the idempotency middleware and would mask it.
  section('W2 duplicate requests');
  {
    const key = 'dup-validate-1';
    const body = { msisdn: '+26771888001' };
    const first = await httpRequest(base, 'POST', '/v1/identity/otp', { body, headers: { 'Idempotency-Key': key } });
    const second = await httpRequest(base, 'POST', '/v1/identity/otp', { body, headers: { 'Idempotency-Key': key } });
    check('HTTP duplicate is replayed, not re-executed', 'Idempotent-Replay=true', second.headers['idempotent-replay'] || 'absent',
      first.status === 200 && second.headers['idempotent-replay'] === 'true');

    let ran = 0;
    const CONCURRENT = 50;
    const outcomes = await Promise.all(
      Array.from({ length: CONCURRENT }, () => platform.distributed.idempotency.runOnce('race-key', async () => { ran += 1; return 'winner'; }))
    );
    const winners = outcomes.filter((o) => o.ran).length;
    report.scenarios.duplicate_requests = { concurrent: CONCURRENT, executed: ran, winners };
    check(`exactly-once under ${CONCURRENT} concurrent duplicates`, 1, ran, ran === 1 && winners === 1);
  }

  // ════ W1 · Sustained + burst HTTP traffic against the real app ════
  section(`W1 sustained load (${CFG.loadSeconds}s × ${CFG.workers} workers)`);
  {
    const MIX = [
      () => httpRequest(base, 'GET', '/health'),
      () => httpRequest(base, 'GET', '/health/full'),
      () => httpRequest(base, 'GET', '/v1/kgetsi/campaigns'),
      () => httpRequest(base, 'GET', '/v1/heritage/search'),
      () => httpRequest(base, 'GET', '/metrics'),
      () => httpRequest(base, 'POST', '/v1/identity/otp', {
        body: { msisdn: `+2677${Math.floor(1000000 + Math.random() * 8999999)}` },
        headers: { 'Idempotency-Key': `w1-${Math.random()}` },
      }),
    ];
    const latencies = [];
    const statuses = {};
    let missingTraceHeaders = 0;
    const deadline = Date.now() + CFG.loadSeconds * 1000;
    const http0 = platform.metrics.counterTotal('motse_http_requests_total');
    await Promise.all(
      Array.from({ length: CFG.workers }, async () => {
        while (Date.now() < deadline) {
          const res = await MIX[Math.floor(Math.random() * MIX.length)]();
          latencies.push(res.ms);
          statuses[res.status] = (statuses[res.status] || 0) + 1;
          if (!res.headers['x-trace-id'] || !res.headers.traceparent) missingTraceHeaders += 1;
        }
      })
    );
    latencies.sort((a, b) => a - b);
    const sent = latencies.length;
    const httpCounted = platform.metrics.counterTotal('motse_http_requests_total') - http0;
    const fiveHundreds = Object.entries(statuses).filter(([code]) => Number(code) >= 500).reduce((n, [, v]) => n + v, 0);
    const s = {
      requests: sent,
      rps: Math.round(sent / CFG.loadSeconds),
      p50_ms: +pct(latencies, 0.5).toFixed(2),
      p95_ms: +pct(latencies, 0.95).toFixed(2),
      p99_ms: +pct(latencies, 0.99).toFixed(2),
      statuses,
      error_5xx: fiveHundreds,
      throttled_429: statuses['429'] || 0,
    };
    report.scenarios.sustained_load = s;
    // eslint-disable-next-line no-console
    console.log(`  ${s.requests} req (${s.rps} rps)  p50=${s.p50_ms}ms p95=${s.p95_ms}ms p99=${s.p99_ms}ms  429=${s.throttled_429} 5xx=${s.error_5xx}`);
    check('metrics count HTTP requests exactly', sent, httpCounted, httpCounted === sent);
    check('every response carries trace headers', 0, missingTraceHeaders, missingTraceHeaders === 0);
    check('zero 5xx under sustained load', 0, fiveHundreds, fiveHundreds === 0);
    check('rate limiting engages under anonymous burst (429s observed)', '>0', s.throttled_429, s.throttled_429 > 0);
    // Mission 2 regression guard: the anonymous bucket is now exhausted, yet
    // an authenticated caller must ride its own class quota (finding 2 fixed).
    const authedDuringThrottle = await httpRequest(base, 'GET', '/v1/wallet/accounts', {
      headers: { Authorization: `Bearer ${opsSession.access_token}`, 'X-Device-Id': 'validator' },
    });
    check('authenticated caller unaffected by exhausted anonymous bucket (M2)', 200, authedDuringThrottle.status, authedDuringThrottle.status === 200);

    // Trace completeness on sampled requests (sent last so the ring buffer still holds them).
    let complete = 0;
    const SAMPLES = 25;
    for (let i = 0; i < SAMPLES; i += 1) {
      const traceId = `${i.toString(16).padStart(2, '0')}${'c'.repeat(30)}`;
      await httpRequest(base, 'GET', '/health/full', { headers: { traceparent: `00-${traceId}-${'d'.repeat(16)}-01` } });
      const spans = platform.tracer.trace(traceId);
      const root = spans.find((sp) => sp.name === 'HTTP GET');
      if (root && root.attributes['http.status_code'] === 200 && root.duration_ms != null) complete += 1;
    }
    check('sampled traces are complete (root span, status, duration)', SAMPLES, complete, complete === SAMPLES);

    const httpLogs = logLines.filter((l) => l.message === 'http');
    const correlated = httpLogs.filter((l) => l.trace_id && l.service === 'motse-core').length;
    report.scenarios.log_correlation = { http_log_lines: httpLogs.length, correlated };
    check('100% of request logs correlate (trace_id + service)', httpLogs.length, correlated, correlated === httpLogs.length && httpLogs.length > 0);
    check('tracer ring buffer stays bounded', `<=${platform.tracer.maxSpans}`, platform.tracer.spans.length, platform.tracer.spans.length <= platform.tracer.maxSpans);
  }

  // ════ W3 · Transaction volume + rollback storm (metric exactness) ════
  section(`W3 transaction volume (${CFG.txns} txns, 10% rollback storm)`);
  {
    const window = snapshotWindow(platform);
    const m = platform.metrics;
    const c0 = m.counterValue('foundation_transaction_total', { result: 'commit' });
    const r0 = m.counterValue('foundation_transaction_total', { result: 'rollback' });
    const col = platform.store.collection('validation_tx');
    const t0 = performance.now();
    let commits = 0;
    let rollbacks = 0;
    for (let i = 0; i < CFG.txns; i += 1) {
      try {
        platform.store.transaction(() => {
          col.insert({ id: `tx-${i}`, i });
          if (i % 10 === 9) throw new Error('storm');
        });
        commits += 1;
      } catch { rollbacks += 1; }
    }
    const elapsed = performance.now() - t0;
    const dc = m.counterValue('foundation_transaction_total', { result: 'commit' }) - c0;
    const dr = m.counterValue('foundation_transaction_total', { result: 'rollback' }) - r0;
    report.scenarios.transaction_volume = {
      txns: CFG.txns, commits, rollbacks,
      throughput_per_s: Math.round(CFG.txns / (elapsed / 1000)),
      us_per_txn: +(elapsed * 1000 / CFG.txns).toFixed(1),
    };
    // eslint-disable-next-line no-console
    console.log(`  ${Math.round(CFG.txns / (elapsed / 1000))} txn/s  (${(elapsed * 1000 / CFG.txns).toFixed(1)}µs/txn)`);
    check('commit counter is exact', commits, dc, dc === commits);
    check('rollback counter is exact', rollbacks, dr, dr === rollbacks);
    check('rolled-back rows are absent', 0, col.find((r) => r.i % 10 === 9).length, col.find((r) => r.i % 10 === 9).length === 0);
    recordAlertPhase(platform, 'rollback-storm', window, ['TransactionFailureSpike']);
  }

  // ════ W4 · Outbox backlog growth, DLQ accumulation, recovery ════
  section(`W4 outbox backlog (${CFG.backlog}) + dead letters (${CFG.dlq}) + recovery`);
  {
    platform.bus.register('validate.backlog', 1, ['n']);
    platform.bus.register('validate.dlq', 1, ['n']);
    let backlogConsumerUp = false;
    platform.bus.subscribe('validate.backlog', 'validator', () => {
      if (!backlogConsumerUp) throw new Error('consumer down');
    });
    let dlqConsumerUp = false;
    platform.bus.subscribe('validate.dlq', 'validator', () => {
      if (!dlqConsumerUp) throw new Error('consumer down');
    });

    const savedMaxAttempts = platform.outbox.maxAttempts;
    // Phase a: backlog grows while the consumer is down (retries keep rows pending).
    platform.outbox.maxAttempts = 9999;
    const windowA = snapshotWindow(platform);
    platform.outbox.run(({ stage }) => {
      for (let i = 0; i < CFG.backlog; i += 1) stage('validate.backlog', { n: i });
    });
    const pendingPeak = platform.outbox.stats().pending;
    const gaugeLine = platform.metrics.render().match(/motse_outbox_pending (\d+)/);
    check('backlog gauge matches reality', pendingPeak, gaugeLine && Number(gaugeLine[1]), gaugeLine && Number(gaugeLine[1]) === pendingPeak);
    recordAlertPhase(platform, 'backlog-growth', windowA, ['OutboxBacklogGrowing']);

    // Recovery: consumer restored → one drain clears the backlog.
    backlogConsumerUp = true;
    const tRec = performance.now();
    platform.outbox.drain();
    const backlogRecoveryMs = +(performance.now() - tRec).toFixed(1);
    check('backlog drains to zero after consumer recovery', 0, platform.outbox.stats().pending, platform.outbox.stats().pending === 0);

    // Phase b: dead-letter accumulation (attempts exhaust), then operator replay.
    platform.outbox.maxAttempts = 1;
    const windowB = snapshotWindow(platform);
    platform.outbox.run(({ stage }) => {
      for (let i = 0; i < CFG.dlq; i += 1) stage('validate.dlq', { n: i });
    });
    const deadPeak = platform.outbox.stats().dead;
    check('dead letters accumulate when retries exhaust', CFG.dlq, deadPeak, deadPeak === CFG.dlq);
    recordAlertPhase(platform, 'dlq-accumulation', windowB, ['OutboxDeadLetterAccumulation']);

    dlqConsumerUp = true;
    const tReplay = performance.now();
    for (const entry of platform.outbox.deadLetters()) platform.outbox.replayDead(entry.id);
    const dlqReplayMs = +(performance.now() - tReplay).toFixed(1);
    check('operator replay clears the DLQ', 0, platform.outbox.stats().dead, platform.outbox.stats().dead === 0);
    platform.outbox.maxAttempts = savedMaxAttempts;
    report.scenarios.outbox_reliability = {
      backlog_peak: pendingPeak, backlog_recovery_ms: backlogRecoveryMs,
      dead_peak: deadPeak, dlq_replay_ms: dlqReplayMs,
    };
    // eslint-disable-next-line no-console
    console.log(`  backlog recovery ${backlogRecoveryMs}ms · DLQ replay ${dlqReplayMs}ms`);
  }

  // ════ W5 · Lock contention + rate-limit saturation ════
  section(`W5 lock contention (${CFG.locks} concurrent) + rate-limit saturation (${CFG.rlBurst} takes)`);
  {
    const windowHealthy = snapshotWindow(platform);
    // Healthy pattern: serial lock use — no contention, limiter within capacity.
    for (let i = 0; i < 20; i += 1) await platform.distributed.lock.withLock(`serial-${i}`, async () => {});
    for (let i = 0; i < 100; i += 1) await platform.distributed.rateLimiter.take(`healthy-${i % 10}`);
    recordAlertPhase(platform, 'healthy-traffic', windowHealthy, []);

    const windowStress = snapshotWindow(platform);
    let acquired = 0;
    let contended = 0;
    await Promise.all(
      Array.from({ length: CFG.locks }, () =>
        platform.distributed.lock
          .withLock('hot-resource', () => new Promise((r) => { setImmediate(r); }))
          .then(() => { acquired += 1; })
          .catch((e) => { if (e.code === 'STATE_CONFLICT') contended += 1; })
      )
    );
    let limited = 0;
    for (let i = 0; i < CFG.rlBurst; i += 1) {
      const r = await platform.distributed.rateLimiter.take('saturating-id');
      if (!r.allowed) limited += 1;
    }
    report.scenarios.contention = {
      locks: CFG.locks, acquired, contended, contention_ratio: +(contended / CFG.locks).toFixed(2),
      rl_takes: CFG.rlBurst, limited, limited_ratio: +(limited / CFG.rlBurst).toFixed(2),
    };
    // eslint-disable-next-line no-console
    console.log(`  locks: ${acquired} acquired / ${contended} contended · limiter: ${limited}/${CFG.rlBurst} limited`);
    check('mutual exclusion held (exactly one winner per wave)', '>=1 acquired', acquired, acquired >= 1 && acquired + contended === CFG.locks);
    recordAlertPhase(platform, 'contention-burst', windowStress, ['LockContentionHigh', 'RateLimitSaturation']);
  }

  // ════ W6 · Chaos: KV outage, transient blips, restart data loss ════
  section('W6 chaos — Redis outage / blips / restart');
  {
    const chaosKv = new ChaosKv(platform.kv);
    platform.kv = chaosKv;
    platform.distributed.idempotency.kv = chaosKv;
    platform.distributed.rateLimiter.kv = chaosKv;
    platform.distributed.lock.kv = chaosKv;

    chaosKv.down();
    let failuresDuringOutage = 0;
    for (let i = 0; i < 10; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await platform.distributed.idempotency.runOnce(`outage-${i}`, () => 'x').catch(() => { failuresDuringOutage += 1; });
    }
    check('operations fail closed during KV outage (no silent success)', 10, failuresDuringOutage, failuresDuringOutage === 10);

    // Mission 1 regression guard: active dependency probes must surface the
    // outage in readiness (the pre-fix engine left readiness green here).
    await platform.dependencies.checkAll();
    const readyDuringOutage = platform.health.ready();
    check('readiness detects the KV outage via dependency probes (M1)', 'not ready', readyDuringOutage.ready ? 'ready' : 'not ready', readyDuringOutage.ready === false);
    check('redis dependency reports failed during outage (M1)', 'failed', platform.dependencies.summary().redis, platform.dependencies.summary().redis === 'failed');

    const tUp = performance.now();
    chaosKv.up();
    const recovered = await platform.distributed.idempotency.runOnce('post-outage', () => 'ok');
    const outageRecoveryMs = +(performance.now() - tUp).toFixed(2);
    check('first operation after outage succeeds (no lingering state)', 'ran', recovered.ran ? 'ran' : 'blocked', recovered.ran === true);

    chaosKv.failNext(1);
    const blip = await platform.distributed.idempotency.runOnce('blip-op', () => 'x').catch(() => 'failed');
    const blipRetry = await platform.distributed.idempotency.runOnce('blip-op', () => 'x');
    check('a transient blip is retryable without duplicate execution', 'failed then ran', `${blip} then ${blipRetry.ran ? 'ran' : 'blocked'}`, blip === 'failed' && blipRetry.ran === true);

    await platform.distributed.idempotency.runOnce('pre-restart', () => 'x');
    chaosKv.restart(new InMemoryKvAdapter({ clock: platform.clock }));
    const reRun = await platform.distributed.idempotency.runOnce('pre-restart', () => 'x');
    check('restart data loss degrades to at-least-once (documented boundary)', 'ran again', reRun.ran ? 'ran again' : 'blocked', reRun.ran === true);
    // Recovery path: two clean probe cycles walk failed → recovering → healthy.
    await platform.dependencies.checkAll();
    await platform.dependencies.checkAll();
    check('dependency state recovers after the outage ends (M1)', 'healthy', platform.dependencies.summary().redis, platform.dependencies.summary().redis === 'healthy');
    report.scenarios.chaos = { outage_ops_failed: failuresDuringOutage, recovery_ms: outageRecoveryMs, kv_stats: chaosKv.stats() };
    // eslint-disable-next-line no-console
    console.log(`  recovery after outage: ${outageRecoveryMs}ms`);
  }

  // ════ W8 · Exporter throughput + failure isolation ════
  section(`W8 OTLP exporter (${CFG.spans} spans)`);
  {
    const collected = [];
    const exporter = new OtelSpanExporter({ transport: (p) => collected.push(p), serviceName: 'validate' });
    const tracer = new Tracer({ clock: new Clock(), maxSpans: 100, sink: (sp) => exporter.accept(sp) });
    const t0 = performance.now();
    for (let i = 0; i < CFG.spans; i += 1) tracer.startSpan('export-bench', { attributes: { i } }).end();
    exporter.flush();
    const elapsed = performance.now() - t0;
    const shipped = collected.reduce((n, p) => n + p.resourceSpans[0].scopeSpans[0].spans.length, 0);
    const rate = Math.round(CFG.spans / (elapsed / 1000));
    report.scenarios.exporter = { spans: CFG.spans, exported: shipped, dropped: exporter.dropped, spans_per_s: rate };
    // eslint-disable-next-line no-console
    console.log(`  ${rate} spans/s exported · dropped=${exporter.dropped}`);
    check('exporter ships every span (zero dropped, healthy transport)', CFG.spans, shipped, shipped === CFG.spans && exporter.dropped === 0);

    const broken = new OtelSpanExporter({ transport: () => { throw new Error('collector down'); } });
    const brokenTracer = new Tracer({ clock: new Clock(), sink: (sp) => broken.accept(sp) });
    const tOk = performance.now();
    for (let i = 0; i < 500; i += 1) brokenTracer.startSpan('x').end();
    broken.flush();
    const brokenElapsed = performance.now() - tOk;
    check('a dead collector never breaks span creation (drops counted)', '500 dropped, no throw', `${broken.dropped} dropped`, broken.dropped === 500);
    report.scenarios.exporter.broken_collector_500_spans_ms = +brokenElapsed.toFixed(1);
  }

  // ════ W9 · Instrumentation overhead (with vs without) ════
  section('W9 instrumentation overhead');
  {
    // Fixed iteration counts in every mode: micro-benchmarks need enough
    // samples to beat JIT/GC noise, and they are cheap. A warmup pass runs
    // first so both variants measure optimized code.
    const N = 20000;
    const OB_N = 5000;
    const benchStore = (store) => {
      const col = store.collection('bench');
      for (let i = 0; i < 2000; i += 1) store.transaction(() => col.insert({ id: `warm-${i}` })); // warmup
      const t0 = performance.now();
      for (let i = 0; i < N; i += 1) store.transaction(() => col.insert({ id: `b-${i}` }));
      return performance.now() - t0;
    };
    const bare = benchStore(new Store());
    const instrumented = benchStore(new Store({ metrics: new Metrics() }));
    const txOverheadPct = +(((instrumented - bare) / bare) * 100).toFixed(1);

    const benchOutbox = (opts) => {
      const store = new Store();
      const clock = new Clock();
      const bus = new EventBus(clock);
      bus.register('bench.evt', 1, ['n']);
      const outbox = new OutboxService({ store, clock, bus, ...opts });
      for (let i = 0; i < 500; i += 1) outbox.run(({ stage }) => stage('bench.evt', { n: i })); // warmup
      const t0 = performance.now();
      for (let i = 0; i < OB_N; i += 1) outbox.run(({ stage }) => stage('bench.evt', { n: i }));
      return performance.now() - t0;
    };
    const obBare = benchOutbox({});
    const obFull = benchOutbox({ metrics: new Metrics(), tracer: new Tracer({ clock: new Clock(), maxSpans: 100 }) });
    const obOverheadPct = +(((obFull - obBare) / obBare) * 100).toFixed(1);

    const heapEnd = process.memoryUsage().heapUsed;
    // Overhead criterion: instrumentation may add at most an absolute floor
    // (sized for slow CI runners; local baselines +1.2µs/txn, +25µs/outbox-op)
    // OR 25% of the bare operation cost, whichever is GREATER. The hybrid is
    // needed because the bare outbox op itself varies severalfold with heap
    // pressure (its drain full-scans the collection — see recommendation),
    // so a pure absolute budget is not stable across run contexts, and a
    // pure percentage is meaningless on ~1µs micro-ops.
    const txnAddedUs = +((instrumented - bare) * 1000 / N).toFixed(2);
    const obAddedUs = +((obFull - obBare) * 1000 / OB_N).toFixed(2);
    const txnBareUs = bare * 1000 / N;
    const obBareUs = obBare * 1000 / OB_N;
    const txnBudgetUs = +Math.max(15, txnBareUs * 0.25).toFixed(1);
    const obBudgetUs = +Math.max(75, obBareUs * 0.25).toFixed(1);
    // Mission 3 regression guard: the pending index holds drain cost flat as
    // published rows accumulate (pre-fix: ~866µs/op at 5.5k rows).
    check('outbox drain cost stays flat with published-row accumulation (M3)', '<300µs/op', `${obBareUs.toFixed(0)}µs`, obBareUs < 300);
    if (obBareUs >= 300) {
      report.recommendations.push(
        `REGRESSION: outbox bare op cost measured ${obBareUs.toFixed(0)}µs at ${OB_N + 500} rows — the pending index should hold this flat; investigate.`
      );
    }
    report.scenarios.overhead = {
      txn_bare_us: +(bare * 1000 / N).toFixed(2),
      txn_instrumented_us: +(instrumented * 1000 / N).toFixed(2),
      txn_added_us: txnAddedUs,
      txn_overhead_pct: txOverheadPct,
      outbox_bare_us: +(obBare * 1000 / OB_N).toFixed(2),
      outbox_instrumented_us: +(obFull * 1000 / OB_N).toFixed(2),
      outbox_added_us: obAddedUs,
      outbox_overhead_pct: obOverheadPct,
      heap_growth_mb: +((heapEnd - heapStart) / 1048576).toFixed(1),
    };
    // eslint-disable-next-line no-console
    console.log(`  txn +${txnAddedUs}µs/op (${txOverheadPct}%) · outbox +${obAddedUs}µs/op (${obOverheadPct}%) · heap +${report.scenarios.overhead.heap_growth_mb}MB`);
    check('transaction instrumentation cost within budget', `<=${txnBudgetUs}µs/txn`, `${txnAddedUs}µs`, txnAddedUs <= txnBudgetUs);
    check('outbox instrumentation cost within budget', `<=${obBudgetUs}µs/op`, `${obAddedUs}µs`, obAddedUs <= obBudgetUs);
  }

  // ════ W10 · Resilience patterns under chaos (Mission 8) ════
  section('W10 resilience patterns under chaos');
  {
    const { CircuitBreaker } = require('../src/resilience/circuit.breaker');
    const { Bulkhead } = require('../src/resilience/bulkhead');
    const { withRetry, withDeadline, RetryBudget } = require('../src/resilience/retry');
    const clk = { nowMs: () => Date.now() };

    // Circuit breaker over a downed KV: trips, then spares the dependency.
    const chaosKv = new ChaosKv(new InMemoryKvAdapter({ clock: platform.clock })).down();
    const cb = new CircuitBreaker({ clock: clk, failureThreshold: 5, cooldownMs: 40, metrics: platform.metrics });
    let raw = 0;
    for (let i = 0; i < 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await cb.exec(() => chaosKv.get('k')).catch(() => {});
    }
    const openState = cb.state;
    const callsAtOpen = chaosKv.stats().calls;
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await cb.exec(() => { raw += 1; return chaosKv.get('k'); }).catch(() => {});
    }
    check('breaker trips open under sustained dependency failure', 'open', openState, openState === 'open');
    check('open breaker spares the dead dependency (fast-fail, no calls)', callsAtOpen, chaosKv.stats().calls, chaosKv.stats().calls === callsAtOpen);
    // Recovery: dependency healthy + cooldown → half-open probe closes.
    chaosKv.up();
    await new Promise((r) => { setTimeout(r, 60); });
    const recovered = await cb.exec(() => chaosKv.get('k')).then(() => true).catch(() => false);
    check('breaker closes after the dependency recovers', 'closed', cb.state, recovered && cb.state === 'closed');

    // Bulkhead isolation: overflow is rejected, the pool never exceeds its cap.
    const bh = new Bulkhead({ name: 'redis', maxConcurrent: 5, maxQueue: 5, metrics: platform.metrics });
    let rejected = 0;
    const slow = () => new Promise((r) => { setTimeout(r, 30); });
    await Promise.all(Array.from({ length: 30 }, () => bh.exec(slow).catch((e) => { if (e.code === 'UNAVAILABLE') rejected += 1; })));
    check('bulkhead sheds overflow instead of cascading', '>0 rejected', rejected, rejected > 0 && bh.stats().peak_active <= 5);

    // Adaptive retry + budget: recovers a transient blip; budget caps a storm.
    const budget = new RetryBudget({ ratio: 0.2, minRetries: 2, clock: clk });
    let tries = 0;
    const retried = await withRetry(async () => { tries += 1; if (tries < 3) throw new Error('blip'); return 'ok'; },
      { attempts: 5, baseMs: 1, budget, metrics: platform.metrics });
    check('adaptive retry recovers a transient failure', 'ok', retried, retried === 'ok');

    // Timeout budget: a hung dependency is abandoned, not awaited forever.
    const hung = new Promise(() => {});
    const deadlineHit = await withDeadline(hung, 20).then(() => false).catch((e) => e.code === 'UNAVAILABLE');
    check('timeout budget abandons a hung call', 'deadline', deadlineHit ? 'deadline' : 'hung', deadlineHit === true);

    // Load shedding: over the in-flight cap, normal paths shed, critical pass.
    const { LoadShedder } = require('../src/resilience/load.shed');
    const shed = new LoadShedder({ maxInFlight: 2, metrics: platform.metrics });
    const mw = shed.middleware();
    const fakeRes = () => ({ on() {}, writableFinished: true });
    let shedCount = 0; let critPass = 0;
    for (let i = 0; i < 5; i += 1) mw({ path: '/v1/search' }, fakeRes(), (e) => { if (e) shedCount += 1; });
    mw({ path: '/health/live' }, fakeRes(), (e) => { if (!e) critPass += 1; });
    mw({ path: '/v1/admin/overview' }, fakeRes(), (e) => { if (!e) critPass += 1; });
    check('load shedder sheds normal traffic over the cap', '>0 shed', shedCount, shedCount > 0);
    check('load shedder never sheds critical paths', 2, critPass, critPass === 2);
    void raw;
  }

  // ════ W11 · Runtime intelligence detects synthetic pressure (Mission 5) ════
  section('W11 runtime intelligence');
  {
    const s = platform.runtime.sample();
    check('runtime sampler reports live heap + event-loop metrics', 'heap>0', s.heap_used_bytes > 0 ? 'heap>0' : 'none', s.heap_used_bytes > 0 && typeof s.event_loop_utilization === 'number');
    check('runtime metrics reach the shared registry', true, platform.metrics.render().includes('motse_runtime_heap_used_bytes'), platform.metrics.render().includes('motse_runtime_heap_used_bytes'));
    // Feed a synthetic leaking window into a private instance to prove the
    // predictive detector fires (the live process should NOT be leaking).
    const { RuntimeIntelligence } = require('../src/observability/runtime.intelligence');
    const probe = new RuntimeIntelligence({ clock: { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() }, sampleMs: 60000 });
    for (let i = 0; i < 8; i += 1) {
      const used = 850_000_000 + i * 5_000_000;
      probe.samples.push({ at_ms: i * 60000, heap_used_bytes: used, heap_limit_bytes: 1_000_000_000, heap_utilization: used / 1e9, event_loop_delay_p99_ms: 2, event_loop_utilization: 0.2, active_handles: 10 });
    }
    const leak = probe.insights().some((x) => x.kind === 'memory_leak_suspected');
    check('runtime detector flags a leaking heap trend', 'leak', leak ? 'leak' : 'none', leak === true);
    const liveLeak = platform.runtime.insights().some((x) => x.kind === 'memory_leak_suspected');
    check('the live process is NOT falsely flagged as leaking', 'clean', liveLeak ? 'FLAGGED' : 'clean', liveLeak === false);
    report.scenarios.resilience = { breaker: 'validated', bulkhead: 'validated', retry: 'validated', deadline: 'validated', load_shedding: 'validated' };
    report.scenarios.runtime = platform.runtime.snapshot().current;
  }

  // ════ W12 · Distributed config applied live (Mission 6) ════
  section('W12 live configuration');
  {
    const breaker = platform.resilience.breaker('redis');
    const before = breaker.failureThreshold;
    platform.config.set('resilience.redis.breaker.failureThreshold', before + 7, { actor: 'validator', reason: 'W12' });
    check('config change applies to the running system with zero restart', before + 7, breaker.failureThreshold, breaker.failureThreshold === before + 7);
    // Validation rejects an out-of-range value.
    let rejected = false;
    try { platform.config.set('resilience.redis.breaker.failureThreshold', -1); } catch { rejected = true; }
    check('config validation rejects an invalid value', 'rejected', rejected ? 'rejected' : 'accepted', rejected === true);
    // Emergency kill switch drives managed knobs to safe values, reversibly.
    const shedBefore = platform.resilience.shedder.maxInFlight;
    platform.config.killSwitch(true, { actor: 'validator' });
    const safe = platform.resilience.shedder.maxInFlight;
    platform.config.killSwitch(false, { actor: 'validator' });
    check('kill switch forces a safe value then restores', `${safe}<${shedBefore} then restore`, `${safe} then ${platform.resilience.shedder.maxInFlight}`, safe < shedBefore && platform.resilience.shedder.maxInFlight === shedBefore);
    // Snapshot → change → restore round-trips.
    platform.config.snapshot('w12-baseline', { actor: 'validator' });
    platform.config.set('resilience.redis.breaker.failureThreshold', 42);
    platform.config.restore('w12-baseline', { actor: 'validator' });
    check('config snapshot restore reverts changes', before + 7, breaker.failureThreshold, breaker.failureThreshold === before + 7);
    report.scenarios.config = platform.config.stats();
  }

  // ════ W13 · Predictive capacity planning (Mission 9) ════
  section('W13 capacity planning');
  {
    for (let i = 0; i < 10; i += 1) { platform.runtime.sample(); platform.capacity.record(); }
    const forecast = platform.capacity.forecast();
    check('capacity forecast produces multi-horizon projections', true, !!forecast.projections.heap.forecast, !!(forecast.projections.heap.forecast && forecast.projections.heap.forecast['365d'] !== undefined));
    check('every projection carries a confidence + assumptions', true,
      forecast.projections.heap.confidence != null && Array.isArray(forecast.projections.heap.assumptions),
      forecast.projections.heap.confidence != null && forecast.projections.heap.assumptions.length > 0);
    check('capacity report yields at least one recommendation', '>=1', forecast.recommendations.length, forecast.recommendations.length >= 1);
    report.scenarios.capacity = { samples: forecast.samples, recommendations: forecast.recommendations.length };
  }

  // ════ Integrity + verdict ════
  section('final integrity');
  check('ledger trial balance held through every scenario', 'balanced', platform.ledger.trialBalance().balanced ? 'balanced' : 'IMBALANCED', platform.ledger.trialBalance().balanced);
  const ready = platform.health.ready();
  check('platform ready after all fault injection', true, ready.ready, ready.ready === true);

  server.close();
  report.finished_at = new Date().toISOString();
  const failed = report.checks.filter((c) => !c.pass);
  report.verdict = failed.length === 0 ? 'PASS' : 'FAIL';

  const outDir = path.join(__dirname, '../docs/evidence');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'production-validation.json'), `${JSON.stringify(report, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(`\n${report.checks.length} checks · ${report.checks.length - failed.length} passed · ${failed.length} failed`);
  if (report.recommendations.length) {
    // eslint-disable-next-line no-console
    console.log(`recommendations: ${report.recommendations.length} (see docs/evidence/production-validation.json)`);
  }
  // eslint-disable-next-line no-console
  console.log(`verdict: ${report.verdict}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('validation harness crashed:', e);
  process.exit(1);
});
