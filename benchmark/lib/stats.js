'use strict';

/**
 * Timing + summary statistics for benchmarks. Durations are measured with
 * `process.hrtime.bigint()` (nanosecond resolution) and reported in
 * milliseconds. Percentiles use the nearest-rank method on the sorted sample.
 */

/** Time a single async call, returning { result, ms }. */
async function timeOnce(fn) {
  const start = process.hrtime.bigint();
  const result = await fn();
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  return { result, ms };
}

/**
 * Run `fn` `samples` times sequentially, collecting per-call latency.
 * `warmup` calls are executed first and discarded (JIT / cache warm-up).
 */
async function measure(label, fn, { samples = 1000, warmup = 20 } = {}) {
  for (let i = 0; i < warmup; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await fn(i);
  }
  const latencies = new Array(samples);
  const start = process.hrtime.bigint();
  for (let i = 0; i < samples; i += 1) {
    const t0 = process.hrtime.bigint();
    // eslint-disable-next-line no-await-in-loop
    await fn(i);
    latencies[i] = Number(process.hrtime.bigint() - t0) / 1e6;
  }
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
  return { label, ...summarize(latencies), samples, wallMs, throughput: round((samples / wallMs) * 1000) };
}

/**
 * Run `fn` with `concurrency` parallel workers until `total` calls complete.
 * Returns latency stats + achieved throughput + error count.
 */
async function measureConcurrent(label, fn, { total = 2000, concurrency = 50 } = {}) {
  const latencies = [];
  let errors = 0;
  let issued = 0;
  const start = process.hrtime.bigint();

  async function worker() {
    for (;;) {
      const i = issued;
      if (i >= total) return;
      issued += 1;
      const t0 = process.hrtime.bigint();
      try {
        // eslint-disable-next-line no-await-in-loop
        await fn(i);
        latencies.push(Number(process.hrtime.bigint() - t0) / 1e6);
      } catch (_err) {
        errors += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
  return {
    label,
    concurrency,
    total,
    errors,
    errorRate: round(errors / total),
    ...summarize(latencies),
    wallMs: round(wallMs),
    throughput: round((latencies.length / wallMs) * 1000),
  };
}

function summarize(latencies) {
  if (!latencies.length) {
    return { count: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0, min: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    mean: round(sum / sorted.length),
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1]),
    min: round(sorted[0]),
  };
}

/** Nearest-rank percentile on an already-sorted array. */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(rank, sorted.length) - 1];
}

function round(n, dp = 3) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

module.exports = { timeOnce, measure, measureConcurrent, summarize, percentile, round };
