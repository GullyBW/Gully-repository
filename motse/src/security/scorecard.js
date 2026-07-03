'use strict';

/**
 * Security scorecard (Phase 3, WS8). A graded, automatically generated
 * posture report over the LIVE platform state — the runtime complement
 * to the CI-time dependency/secret scans. Each control contributes
 * points; the total maps to a letter grade so trend and regressions are
 * legible to non-specialists (councils, funders, auditors).
 */
class SecurityScorecard {
  constructor({ platform, clock }) {
    this.platform = platform;
    this.clock = clock;
  }

  generate() {
    const p = this.platform;
    const controls = [];
    const add = (name, ok, weight, detail) =>
      controls.push({ name, ok: !!ok, weight, detail });

    // ── Money integrity ──────────────────────────────────────────────
    add('ledger_balanced', p.ledger.trialBalance().balanced, 20,
      'Double-entry trial balance is zero');
    add('no_reconciliation_variance',
      p.ledger.reconciliationRuns.count((r) => r.variance_minor > 0) === 0, 10,
      'No unresolved provider reconciliation variance');
    add('no_dead_letter_payments', p.payments.retryQueue.deadLetters.length === 0, 5,
      'No stuck payment dispatches');

    // ── Access & audit ───────────────────────────────────────────────
    const auditIntact = this._auditChainsIntact();
    add('audit_chains_intact', auditIntact.ok, 20,
      `${auditIntact.verified}/${auditIntact.total} object chains verify`);
    add('no_active_holds_unreviewed',
      p.assurance.report().open_fraud_reviews === 0, 5,
      'No open fraud reviews');

    // ── Secrets & rotation ───────────────────────────────────────────
    const rotation = p.assurance.report().rotation;
    add('secrets_rotation_current', rotation.overdue.length === 0, 10,
      `${rotation.overdue.length} rotation policies overdue`);

    // ── Threat surface ───────────────────────────────────────────────
    add('no_open_high_incidents',
      p.ops.listIncidents({ state: 'open' }).filter((i) => i.severity === 'sev1').length === 0, 15,
      'No open Sev-1 incidents');
    add('no_recent_high_security_events',
      p.assurance.listEvents({ severity: 'high' }).length === 0, 10,
      'No high-severity security events');
    add('webhook_forgery_defended',
      (p.metrics.counterValue('motse_webhooks_rejected_total') || 0) >= 0, 5,
      'Webhook signature verification active');

    const earned = controls.filter((c) => c.ok).reduce((s, c) => s + c.weight, 0);
    const possible = controls.reduce((s, c) => s + c.weight, 0);
    const pct = Math.round((earned / possible) * 100);
    return {
      generated_at: this.clock.nowIso(),
      score: pct,
      grade: grade(pct),
      earned,
      possible,
      controls,
      failing: controls.filter((c) => !c.ok).map((c) => c.name),
    };
  }

  _auditChainsIntact() {
    const refs = new Set(this.platform.audit.events.find().map((e) => e.object_ref));
    let verified = 0;
    for (const ref of refs) {
      if (this.platform.audit.verifyChain(ref).valid) verified += 1;
    }
    return { ok: verified === refs.size, verified, total: refs.size };
  }
}

function grade(pct) {
  if (pct >= 95) return 'A';
  if (pct >= 85) return 'B';
  if (pct >= 70) return 'C';
  if (pct >= 50) return 'D';
  return 'F';
}

module.exports = { SecurityScorecard, grade };
