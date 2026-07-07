'use strict';

/**
 * HTTP load test (Phase 2, WS10) — dependency-free concurrency driver.
 *   1) npm run motse:start
 *   2) node motse/scripts/load-test.js [baseUrl] [seconds] [concurrency]
 * Drives a read-heavy mix (the doc's traffic shape) plus USSD sessions,
 * and reports throughput + latency percentiles against the §15.1 SLOs.
 * Optional chaos: CHAOS=1 injects provider faults mid-run.
 */
const http = require('http');

const base = process.argv[2] || 'http://127.0.0.1:4100';
const seconds = Number(process.argv[3]) || 10;
const concurrency = Number(process.argv[4]) || 20;

const latencies = [];
let requests = 0;
let failures = 0;

function hit(path, method = 'GET', body = null, headers = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request(
      `${base}${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(method !== 'GET' ? { 'Idempotency-Key': `load-${Math.random()}` } : {}),
          ...headers,
        },
      },
      (res) => {
        res.resume();
        res.on('end', () => {
          latencies.push(Number(process.hrtime.bigint() - started) / 1e6);
          requests += 1;
          if (res.statusCode >= 500) failures += 1;
          resolve();
        });
      }
    );
    req.on('error', () => {
      failures += 1;
      resolve();
    });
    if (payload) req.write(payload);
    req.end();
  });
}

const MIX = [
  () => hit('/health'),
  () => hit('/v1/heritage/search'),
  () => hit('/v1/kgetsi/campaigns'),
  () => hit('/v1/loeto/experiences'),
  () => hit('/metrics'),
  () =>
    hit('/v1/gateway/ussd/session', 'POST', {
      session_id: `load-${Math.floor(Math.random() * 1000)}`,
      msisdn: `+2677${Math.floor(1000000 + Math.random() * 8999999)}`,
      text: '',
    }),
];

async function worker(deadline) {
  while (Date.now() < deadline) {
    await MIX[Math.floor(Math.random() * MIX.length)]();
  }
}

(async () => {
  // eslint-disable-next-line no-console
  console.log(`Load test: ${base} · ${seconds}s · ${concurrency} workers`);
  const deadline = Date.now() + seconds * 1000;
  await Promise.all(Array.from({ length: concurrency }, () => worker(deadline)));
  latencies.sort((a, b) => a - b);
  const pct = (q) => latencies[Math.min(Math.floor(latencies.length * q), latencies.length - 1)] || 0;
  const rps = Math.round(requests / seconds);
  // eslint-disable-next-line no-console
  console.log(
    [
      `requests: ${requests} (${rps} rps)`,
      `failures: ${failures}`,
      `p50: ${pct(0.5).toFixed(1)}ms`,
      `p95: ${pct(0.95).toFixed(1)}ms (SLO: <300ms reads, <1500ms USSD §15.1)`,
      `p99: ${pct(0.99).toFixed(1)}ms`,
    ].join('\n')
  );
  process.exit(failures > requests * 0.01 ? 1 : 0);
})();
