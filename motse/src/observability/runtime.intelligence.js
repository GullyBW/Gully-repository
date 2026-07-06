'use strict';

const v8 = require('v8');
const { performance, monitorEventLoopDelay, PerformanceObserver, constants } = require('perf_hooks');

const NOOP_METRICS = { setGauge() {}, observe() {}, inc() {} };

/**
 * Runtime intelligence (Mission 5). Collects Node.js runtime + process
 * telemetry the application metrics can't see — heap, GC, event-loop delay
 * and utilization, RSS, handle counts — samples it on an interval, and
 * derives PREDICTIVE insights (memory-leak trend, event-loop stalls,
 * resource-exhaustion pressure) rather than only raw gauges.
 *
 * Uses only Node core (perf_hooks, v8). Additive: `start()` is opt-in and
 * `stop()` fully releases the timer + observers; nothing samples until
 * started, so tests and existing wiring are unaffected. Metrics land in the
 * shared registry so /metrics exposes them for Prometheus.
 */
class RuntimeIntelligence {
  constructor({ clock, metrics = null, sampleMs = 5000, historySize = 240 } = {}) {
    this.clock = clock || { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() };
    this.metrics = metrics || NOOP_METRICS;
    this.sampleMs = sampleMs;
    this.historySize = historySize; // 240 × 5s = 20 min at default cadence
    this.samples = [];
    this.gc = { count: 0, total_ms: 0, major: 0, minor: 0 };
    this._loopDelay = null; // monitorEventLoopDelay histogram
    this._gcObserver = null;
    this._timer = null;
    this._lastLoopUtil = null;
  }

  /** Begin sampling. Idempotent. */
  start() {
    if (this._timer) return this;
    // High-resolution event-loop delay histogram (nanoseconds).
    this._loopDelay = monitorEventLoopDelay({ resolution: 20 });
    this._loopDelay.enable();
    this._lastLoopUtil = performance.eventLoopUtilization();
    // GC telemetry via PerformanceObserver (callback fires only on real GC,
    // whose timing is nondeterministic; _recordGc is unit-tested directly).
    this._gcObserver = new PerformanceObserver((list) => {
      /* istanbul ignore next */
      for (const entry of list.getEntries()) this._recordGc(entry);
    });
    this._gcObserver.observe({ entryTypes: ['gc'] });
    this.sample(); // seed one immediately
    this._timer = setInterval(() => this.sample(), this.sampleMs);
    if (this._timer.unref) this._timer.unref(); // never hold the process open
    return this;
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this._gcObserver) { this._gcObserver.disconnect(); this._gcObserver = null; }
    if (this._loopDelay) { this._loopDelay.disable(); this._loopDelay = null; }
    return this;
  }

  /** Take one sample now; records gauges and returns it. */
  sample() {
    const mem = process.memoryUsage();
    const heap = v8.getHeapStatistics();
    const elu = performance.eventLoopUtilization(this._lastLoopUtil);
    this._lastLoopUtil = performance.eventLoopUtilization();
    const loopP99Ms = this._loopDelay ? this._loopDelay.percentile(99) / 1e6 : 0;
    const loopMeanMs = this._loopDelay ? this._loopDelay.mean / 1e6 : 0;
    if (this._loopDelay) this._loopDelay.reset();

    const s = {
      at: this.clock.nowIso(),
      at_ms: this.clock.nowMs(),
      heap_used_bytes: mem.heapUsed,
      heap_total_bytes: mem.heapTotal,
      heap_limit_bytes: heap.heap_size_limit,
      external_bytes: mem.external,
      rss_bytes: mem.rss,
      array_buffers_bytes: mem.arrayBuffers || 0,
      heap_utilization: heap.heap_size_limit ? mem.heapUsed / heap.heap_size_limit : 0,
      event_loop_utilization: elu.utilization,
      event_loop_delay_p99_ms: round(loopP99Ms),
      event_loop_delay_mean_ms: round(loopMeanMs),
      gc_count: this.gc.count,
      gc_total_ms: round(this.gc.total_ms),
      active_handles: countHandles(),
    };
    this.samples.push(s);
    if (this.samples.length > this.historySize) this.samples.shift();

    // Gauges → Prometheus (last-write-wins on scrape).
    this.metrics.setGauge('motse_runtime_heap_used_bytes', {}, s.heap_used_bytes);
    this.metrics.setGauge('motse_runtime_heap_limit_bytes', {}, s.heap_limit_bytes);
    this.metrics.setGauge('motse_runtime_rss_bytes', {}, s.rss_bytes);
    this.metrics.setGauge('motse_runtime_heap_utilization', {}, round(s.heap_utilization));
    this.metrics.setGauge('motse_runtime_event_loop_utilization', {}, round(s.event_loop_utilization));
    this.metrics.setGauge('motse_runtime_event_loop_delay_p99_ms', {}, s.event_loop_delay_p99_ms);
    this.metrics.setGauge('motse_runtime_active_handles', {}, s.active_handles);
    this.metrics.setGauge('motse_runtime_gc_total_ms', {}, s.gc_total_ms);
    return s;
  }

  /** Record one GC PerformanceEntry (extracted for testability). */
  _recordGc(entry) {
    this.gc.count += 1;
    this.gc.total_ms += entry.duration;
    if (entry.detail && entry.detail.kind === constants.NODE_PERFORMANCE_GC_MAJOR) this.gc.major += 1;
    else this.gc.minor += 1;
    this.metrics.observe('motse_runtime_gc_pause_ms', {}, entry.duration);
  }

  /** Current event-loop delay p99 in ms — the LoadShedder's lag signal. */
  loopLagMs() {
    return this.samples.length ? this.samples[this.samples.length - 1].event_loop_delay_p99_ms : 0;
  }

  /**
   * Predictive insights over the sample window. Each is a typed signal an
   * operator (or an alert) can act on — not just a raw number.
   */
  insights() {
    const out = [];
    const n = this.samples.length;
    if (n < 3) return out;
    const first = this.samples[0];
    const last = this.samples[n - 1];
    const spanMs = last.at_ms - first.at_ms || 1;

    // Memory-leak trend: sustained monotone-ish heap growth via least-squares
    // slope over the window, projected to the heap limit.
    const slope = leastSquaresSlope(this.samples.map((s, i) => [i, s.heap_used_bytes]));
    const growthPerMin = slope * (60000 / this.sampleMs);
    if (growthPerMin > 0 && last.heap_utilization > 0.5) {
      const headroom = last.heap_limit_bytes - last.heap_used_bytes;
      const minsToLimit = growthPerMin > 0 ? headroom / growthPerMin : Infinity;
      if (minsToLimit < 120) {
        out.push({
          kind: 'memory_leak_suspected', severity: minsToLimit < 30 ? 'critical' : 'warning',
          detail: `heap +${humanBytes(growthPerMin)}/min, ~${Math.round(minsToLimit)}min to limit`,
          heap_utilization: round(last.heap_utilization),
        });
      }
    }

    // Event-loop stall: p99 delay above 100ms is user-visible latency.
    if (last.event_loop_delay_p99_ms > 100) {
      out.push({
        kind: 'event_loop_stall', severity: last.event_loop_delay_p99_ms > 500 ? 'critical' : 'warning',
        detail: `event-loop p99 delay ${last.event_loop_delay_p99_ms}ms`,
      });
    }

    // Saturation: sustained high event-loop utilization = CPU-bound.
    const avgElu = mean(this.samples.map((s) => s.event_loop_utilization));
    if (avgElu > 0.85) {
      out.push({ kind: 'resource_exhaustion', severity: avgElu > 0.95 ? 'critical' : 'warning', detail: `event-loop utilization avg ${round(avgElu)} over window` });
    }

    // Handle growth: leaking sockets/timers.
    const handleSlope = leastSquaresSlope(this.samples.map((s, i) => [i, s.active_handles]));
    if (handleSlope * (60000 / this.sampleMs) > 50) {
      out.push({ kind: 'handle_leak_suspected', severity: 'warning', detail: `active handles +${Math.round(handleSlope * (60000 / this.sampleMs))}/min` });
    }
    void spanMs;
    return out;
  }

  snapshot() {
    const last = this.samples[this.samples.length - 1] || null;
    return {
      sampling: !!this._timer,
      sample_ms: this.sampleMs,
      samples: this.samples.length,
      current: last,
      gc: this.gc,
      insights: this.insights(),
    };
  }
}

function round(n) { return Math.round(n * 1000) / 1000; }
function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }

function leastSquaresSlope(points) {
  const n = points.length;
  if (n < 2) return 0;
  let sx = 0; let sy = 0; let sxy = 0; let sxx = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const denom = n * sxx - sx * sx;
  return denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
}

function humanBytes(n) {
  const abs = Math.abs(n);
  if (abs > 1 << 30) return `${(n / (1 << 30)).toFixed(1)}GB`;
  if (abs > 1 << 20) return `${(n / (1 << 20)).toFixed(1)}MB`;
  if (abs > 1 << 10) return `${(n / (1 << 10)).toFixed(1)}KB`;
  return `${Math.round(n)}B`;
}

/* istanbul ignore next: _getActiveHandles is internal and platform-variant */
function countHandles() {
  return typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : 0;
}

module.exports = { RuntimeIntelligence, leastSquaresSlope };
