'use strict';

/**
 * Monitoring service: wires domain metrics off the event bus (RED per
 * module, ledger invariants, payment/escrow/queue/sync health) and
 * provides the HTTP middleware + readiness checks (doc §16).
 */
class MonitoringService {
  constructor({ metrics, logger, clock, bus, platform }) {
    this.metrics = metrics;
    this.logger = logger;
    this.clock = clock;
    this.bus = bus;
    this.platform = platform;
    this._wireDomainMetrics();
    this._wireGauges();
  }

  _wireDomainMetrics() {
    // Every domain event counts — audit metrics for free.
    const countEvent = (event) =>
      this.metrics.inc('motse_domain_events_total', { type: event.type });
    for (const type of this.bus.schemas.keys()) {
      this.bus.subscribe(type, 'monitoring-counter', countEvent);
    }
    // Payment + ledger specifics.
    this.bus.subscribe('payments.intent.completed', 'monitoring', (e) =>
      this.metrics.inc('motse_payments_total', { provider: e.data.provider, outcome: 'completed' })
    );
    this.bus.subscribe('payments.intent.failed', 'monitoring', (e) =>
      this.metrics.inc('motse_payments_total', { provider: e.data.provider, outcome: 'failed' })
    );
    this.bus.subscribe('payments.webhook.rejected', 'monitoring', (e) =>
      this.metrics.inc('motse_webhooks_rejected_total', {
        provider: e.data.provider,
        reason: e.data.reason,
      })
    );
    this.bus.subscribe('ledger.posting.rejected', 'monitoring', (e) =>
      this.metrics.inc('motse_ledger_rejections_total', { reason: e.data.reason })
    );
    this.bus.subscribe('ledger.reconciliation.variance', 'monitoring', (e) => {
      this.metrics.inc('motse_reconciliation_variance_total');
      this.logger.error('reconciliation variance — Sev-1', {
        variance_minor: e.data.variance_minor,
      });
    });
    this.bus.subscribe('notification.dispatched', 'monitoring', (e) =>
      this.metrics.inc('motse_notifications_total', { category: e.data.category })
    );
  }

  _wireGauges() {
    const p = this.platform;
    // Ledger invariant: a nonzero trial balance is an incident (§16).
    this.metrics.gaugeFn('motse_ledger_trial_balance_minor', () => p.ledger.trialBalance().total_minor);
    this.metrics.gaugeFn('motse_payment_retry_queue_depth', () =>
      p.payments ? p.payments.retryQueue.depth() : 0
    );
    this.metrics.gaugeFn('motse_payment_dead_letters', () =>
      p.payments ? p.payments.retryQueue.deadLetters.length : 0
    );
    this.metrics.gaugeFn('motse_escrows_frozen', () =>
      p.escrow.escrows.count((e) => e.frozen)
    );
    this.metrics.gaugeFn('motse_escrows_stuck', () => this.stuckEscrows().length);
    this.metrics.gaugeFn('motse_outbox_mutations_applied', () => p.sync.applied.size);
    this.metrics.gaugeFn('motse_users_total', () => p.identity.users.count());
    this.metrics.gaugeFn('motse_audit_events_total', () => p.audit.events.count());
    // Foundation live gauges (Phase A) — clean absolute values for alerting:
    // transactional-outbox backlog/dead-letters and the distributed adapter mode.
    this.metrics.gaugeFn('motse_outbox_pending', () => (p.outbox ? p.outbox.stats().pending : 0));
    this.metrics.gaugeFn('motse_outbox_dead', () => (p.outbox ? p.outbox.stats().dead : 0));
    this.metrics.gaugeFn('motse_distributed_redis_backed', () =>
      p.kv && p.kv.constructor.name === 'RedisKvAdapter' ? 1 : 0
    );
  }

  /** Escrows funded but untouched for 30+ days — the §16 stuck monitor. */
  stuckEscrows() {
    const cutoff = this.clock.nowMs() - 30 * 24 * 3600 * 1000;
    return this.platform.escrow.escrows.find(
      (e) =>
        e.funded_minor > e.released_minor + e.refunded_minor &&
        new Date(e.created_at).getTime() < cutoff
    );
  }

  /** Express middleware: request counters + latency histograms + logs. */
  httpMiddleware() {
    return (req, res, next) => {
      const start = process.hrtime.bigint();
      res.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
        const route = (req.route && req.baseUrl + req.route.path) || req.path;
        this.metrics.inc('motse_http_requests_total', {
          method: req.method,
          route,
          code: res.statusCode,
        });
        this.metrics.observe('motse_http_request_duration_ms', { method: req.method }, durationMs);
        this.logger.info('http', {
          trace_id: req.traceId,
          method: req.method,
          path: req.originalUrl,
          code: res.statusCode,
          duration_ms: Math.round(durationMs * 100) / 100,
          actor: req.actor || null,
        });
      });
      next();
    };
  }

  /** Readiness: dependency + invariant checks (doc §16 canary gates). */
  readiness() {
    const p = this.platform;
    const checks = {
      ledger_balanced: p.ledger.trialBalance().balanced,
      payment_providers: p.payments ? p.payments.providers.size > 0 : false,
      retry_queue_healthy: p.payments ? p.payments.retryQueue.deadLetters.length === 0 : true,
      event_bus: p.bus.schemas.size > 0,
    };
    return { ready: Object.values(checks).every(Boolean), checks };
  }
}

module.exports = { MonitoringService };
