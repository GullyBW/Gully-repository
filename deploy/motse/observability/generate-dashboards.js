'use strict';

/**
 * Grafana dashboard generator (Phase 2, WS4). One spec per domain →
 * one dashboard JSON each; regenerate with:
 *   node deploy/motse/observability/generate-dashboards.js
 * Checked-in outputs live in ./dashboards. Panels are Prometheus-backed
 * (datasource uid "prometheus") over the /metrics series.
 */
const fs = require('fs');
const path = require('path');

const rate = (expr) => `sum(rate(${expr}[5m]))`;
const p95 = (metric) =>
  `histogram_quantile(0.95, sum(rate(${metric}_bucket[5m])) by (le))`;

const DASHBOARDS = {
  system: {
    title: 'Motse · System',
    panels: [
      ['Request throughput (rps)', rate('motse_http_requests_total')],
      ['Latency p95 (ms)', p95('motse_http_request_duration_ms')],
      ['Error rate (5xx rps)', rate('motse_http_requests_total{code=~"5.."}')],
      ['4xx rate (rps)', rate('motse_http_requests_total{code=~"4.."}')],
      ['Users total', 'motse_users_total'],
      ['CPU usage', 'sum(rate(container_cpu_usage_seconds_total{pod=~"motse-core.*"}[5m]))'],
      ['Memory (bytes)', 'sum(container_memory_working_set_bytes{pod=~"motse-core.*"})'],
    ],
  },
  payments: {
    title: 'Motse · Payments',
    panels: [
      ['Payments by outcome', 'sum by (outcome) (rate(motse_payments_total[5m]))'],
      ['Success rate (%)',
        '100 * sum(rate(motse_payments_total{outcome="completed"}[5m])) / clamp_min(sum(rate(motse_payments_total[5m])), 1e-9)'],
      ['Webhook rejections by reason', 'sum by (reason) (rate(motse_webhooks_rejected_total[5m]))'],
      ['Retry queue depth', 'motse_payment_retry_queue_depth'],
      ['Dead letters', 'motse_payment_dead_letters'],
      ['Per-provider volume', 'sum by (provider) (rate(motse_payments_total[5m]))'],
    ],
  },
  ledger: {
    title: 'Motse · Ledger',
    panels: [
      ['Trial balance (MUST be 0)', 'motse_ledger_trial_balance_minor'],
      ['Postings committed (rps)', rate('motse_domain_events_total{type="ledger.posting.committed"}')],
      ['Posting rejections by reason', 'sum by (reason) (rate(motse_ledger_rejections_total[5m]))'],
      ['Reconciliation variances', 'increase(motse_reconciliation_variance_total[24h])'],
      ['Payouts settled (rps)', rate('motse_domain_events_total{type="ledger.payout.settled"}')],
    ],
  },
  escrow: {
    title: 'Motse · Escrow',
    panels: [
      ['Frozen escrows', 'motse_escrows_frozen'],
      ['Stuck escrows (30d+)', 'motse_escrows_stuck'],
      ['Milestones released (rps)', rate('motse_domain_events_total{type="kgetsi.milestone.released"}')],
      ['Contributions (rps)', rate('motse_domain_events_total{type="kgetsi.contribution.received"}')],
    ],
  },
  governance: {
    title: 'Motse · Governance',
    panels: [
      ['Seats frozen (Ring 3)', rate('motse_domain_events_total{type="governance.seat.frozen"}')],
      ['Disputes opened', rate('motse_domain_events_total{type="governance.dispute.opened"}')],
      ['Disputes resolved', rate('motse_domain_events_total{type="governance.dispute.resolved"}')],
      ['Audit events total', 'motse_audit_events_total'],
    ],
  },
  search: {
    title: 'Motse · Search',
    panels: [
      ['Search requests (rps)', rate('motse_http_requests_total{route="/v1/search"}')],
      ['Search errors', rate('motse_http_requests_total{route="/v1/search",code=~"4..|5.."}')],
    ],
  },
  notifications: {
    title: 'Motse · Notifications',
    panels: [
      ['Dispatched by category', 'sum by (category) (rate(motse_notifications_total[5m]))'],
      ['Civic alerts (exempt category)', rate('motse_domain_events_total{type="kgotla.alert.published"}')],
    ],
  },
  'offline-sync': {
    title: 'Motse · Offline Sync',
    panels: [
      ['Outbox mutations applied', 'motse_outbox_mutations_applied'],
      ['Sync batches (rps)', rate('motse_http_requests_total{route="/v1/sync/outbox"}')],
      ['Sync failures', rate('motse_http_requests_total{route="/v1/sync/outbox",code=~"4..|5.."}')],
      ['USSD/SMS letsema joins', rate('motse_domain_events_total{type="kgotla.letsema.joined"}')],
    ],
  },
  authentication: {
    title: 'Motse · Authentication',
    panels: [
      ['OTP requests (rps)', rate('motse_http_requests_total{route="/v1/identity/otp"}')],
      ['Login failures', rate('motse_http_requests_total{route="/v1/identity/otp/verify",code=~"4.."}')],
      ['Authz denials by code', 'sum by (code) (rate(motse_authz_denials_total[5m]))'],
      ['Security events', rate('motse_domain_events_total{type="security.event.raised"}')],
    ],
  },
  ussd: {
    title: 'Motse · USSD',
    panels: [
      ['USSD sessions (rps)', rate('motse_http_requests_total{route="/v1/gateway/ussd/session"}')],
      ['USSD p95 (ms) — operator budget 1500ms (§15.1)', p95('motse_http_request_duration_ms')],
      ['SMS inbound (rps)', rate('motse_http_requests_total{route="/v1/gateway/sms/inbound"}')],
    ],
  },
  // ── Foundation & Phase-2 observability (operationalized in Phase A) ──
  foundation: {
    title: 'Motse · Foundation — Transactions',
    panels: [
      ['Transaction rate (commit vs rollback, rps)',
        'sum by (result) (rate(foundation_transaction_total[5m]))'],
      ['Success rate (%)',
        '100 * sum(rate(foundation_transaction_total{result="commit"}[5m])) / clamp_min(sum(rate(foundation_transaction_total[5m])), 1e-9)'],
      ['Rollback frequency (rps)', rate('foundation_transaction_total{result="rollback"}')],
      ['Commit latency p95 (ms)', p95('foundation_transaction_ms')],
      ['Idempotency: first vs duplicate (rps)',
        'sum by (result) (rate(foundation_idempotency_total[5m]))'],
    ],
  },
  outbox: {
    title: 'Motse · Foundation — Transactional Outbox',
    panels: [
      ['Publish throughput by type (rps)',
        'sum by (type) (rate(foundation_outbox_published_total[5m]))'],
      ['Publish latency p95 (ms)', p95('foundation_outbox_publish_ms')],
      ['Retry rate (rps)', rate('foundation_outbox_retried_total')],
      ['Dead-letter depth', 'motse_outbox_dead'],
      ['Backlog (pending)', 'motse_outbox_pending'],
    ],
  },
  distributed: {
    title: 'Motse · Foundation — Distributed Runtime (Redis)',
    panels: [
      ['Lock acquisition (acquired vs contended, rps)',
        'sum by (result) (rate(foundation_lock_total[5m]))'],
      ['Lock contention rate (%)',
        '100 * sum(rate(foundation_lock_total{result="contended"}[5m])) / clamp_min(sum(rate(foundation_lock_total[5m])), 1e-9)'],
      ['Rate limiter: allowed vs limited (rps)',
        'sum by (result) (rate(foundation_ratelimit_total[5m]))'],
      ['Idempotency hits (duplicate, rps)', rate('foundation_idempotency_total{result="duplicate"}')],
      ['KV adapter (0=in-memory, 1=redis)', 'motse_distributed_redis_backed'],
    ],
  },
};

function dashboard(key, spec) {
  return {
    uid: `motse-${key}`,
    title: spec.title,
    schemaVersion: 39,
    tags: ['motse', key],
    time: { from: 'now-6h', to: 'now' },
    refresh: '30s',
    panels: spec.panels.map(([title, expr], i) => ({
      id: i + 1,
      title,
      type: 'timeseries',
      datasource: { type: 'prometheus', uid: 'prometheus' },
      gridPos: { h: 8, w: 12, x: (i % 2) * 12, y: Math.floor(i / 2) * 8 },
      targets: [{ expr, refId: 'A' }],
    })),
  };
}

const outDir = path.join(__dirname, 'dashboards');
fs.mkdirSync(outDir, { recursive: true });
for (const [key, spec] of Object.entries(DASHBOARDS)) {
  fs.writeFileSync(
    path.join(outDir, `${key}.json`),
    `${JSON.stringify(dashboard(key, spec), null, 2)}\n`
  );
}
// eslint-disable-next-line no-console
console.log(`Generated ${Object.keys(DASHBOARDS).length} dashboards in ${outDir}`);
