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
}

module.exports = new MetricsService();
