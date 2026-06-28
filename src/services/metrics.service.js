'use strict';

/**
 * Lightweight in-process metrics. Counts requests by status class plus errors,
 * exposed at GET /metrics for scraping/health dashboards. For multi-instance
 * production, point a real collector (Prometheus client / OpenTelemetry) at the
 * same hook in `record`.
 */
class MetricsService {
  constructor() {
    this.startedAt = Date.now();
    this.reset();
  }

  reset() {
    this.requestsTotal = 0;
    this.byStatus = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
    this.errors = 0;
  }

  record(statusCode) {
    this.requestsTotal += 1;
    const cls = `${Math.floor(statusCode / 100)}xx`;
    if (this.byStatus[cls] !== undefined) this.byStatus[cls] += 1;
    if (statusCode >= 500) this.errors += 1;
  }

  snapshot() {
    const mem = process.memoryUsage();
    return {
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      requestsTotal: this.requestsTotal,
      byStatus: { ...this.byStatus },
      errors: this.errors,
      memory: { rssMb: Math.round(mem.rss / 1048576), heapUsedMb: Math.round(mem.heapUsed / 1048576) },
    };
  }

  /** Prometheus text exposition (no extra dependency). */
  prometheus() {
    const s = this.snapshot();
    const lines = [
      '# HELP tirelo_uptime_seconds Process uptime in seconds.',
      '# TYPE tirelo_uptime_seconds gauge',
      `tirelo_uptime_seconds ${s.uptimeSeconds}`,
      '# HELP tirelo_requests_total Total HTTP requests handled.',
      '# TYPE tirelo_requests_total counter',
      `tirelo_requests_total ${s.requestsTotal}`,
      '# HELP tirelo_requests_by_status HTTP requests by status class.',
      '# TYPE tirelo_requests_by_status counter',
      ...Object.entries(s.byStatus).map(([k, v]) => `tirelo_requests_by_status{class="${k}"} ${v}`),
      '# HELP tirelo_errors_total 5xx responses.',
      '# TYPE tirelo_errors_total counter',
      `tirelo_errors_total ${s.errors}`,
      '# HELP tirelo_memory_bytes Process memory.',
      '# TYPE tirelo_memory_bytes gauge',
      `tirelo_memory_bytes{type="rss"} ${s.memory.rssMb * 1048576}`,
      `tirelo_memory_bytes{type="heap_used"} ${s.memory.heapUsedMb * 1048576}`,
    ];
    return `${lines.join('\n')}\n`;
  }
}

module.exports = new MetricsService();
