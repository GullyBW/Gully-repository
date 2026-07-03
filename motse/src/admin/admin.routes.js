'use strict';

const express = require('express');
const { err } = require('../kernel/errors');
const { paginate } = require('../kernel/pagination');
const { AuditLog } = require('../platform/governance/auditLog');

/**
 * Administration API (Phase 1). Mounted under /v1/admin so the gateway
 * idempotency middleware covers every admin mutation too.
 *
 * Authorization: platform_admin(platform) role on an L3 account — the
 * same contextual-RBAC machinery as everything else (§5.2). The ledger
 * explorer is strictly read-only: there is no admin route that writes a
 * posting, and audit records have no mutation surface at all.
 */
function createAdminRouter(platform, { auth, bootstrapToken }) {
  const router = express.Router();

  const run = (handler) => (req, res, next) => {
    try {
      const result = handler(req, res);
      if (result !== undefined && !res.headersSent) res.json(result);
    } catch (e) {
      next(e);
    }
  };

  const requireAdmin = (req, res, next) => {
    try {
      platform.identity.requireLevel(req.actor, 'L3');
      platform.identity.requireRole(req.actor, 'platform_admin', 'platform');
      next();
    } catch (e) {
      next(e);
    }
  };

  // ── Bootstrap (deploy-time only; token from the environment) ───────
  router.post('/bootstrap', run((req) => {
    if (!bootstrapToken || req.get('X-Bootstrap-Token') !== bootstrapToken) {
      throw err('PERMISSION_DENIED', 'Invalid bootstrap token');
    }
    const user = platform.identity.findOrCreateByMsisdn(req.body.msisdn);
    platform.identity.grantInstitutional(
      user.id,
      { institution: 'Motse Platform Operations' },
      'system:bootstrap'
    );
    platform.identity.grantRole(user.id, 'platform_admin', 'platform', 'system:bootstrap');
    return { user_id: user.id, granted: 'platform_admin(platform)' };
  }));

  router.use(auth, requireAdmin);

  // ── Dashboard ──────────────────────────────────────────────────────
  router.get('/dashboard', run(() => {
    const p = platform;
    const usersByLevel = { L0: 0, L1: 0, L2: 0, L3: 0 };
    let suspended = 0;
    for (const user of p.identity.users.find()) {
      usersByLevel[user.level] += 1;
      if (user.suspended) suspended += 1;
    }
    const escrows = p.escrow.escrows.find();
    const pendingMilestones = p.kgetsi.campaigns
      .find()
      .flatMap((c) =>
        c.milestones
          .filter((m) => ['evidence_submitted', 'approved'].includes(m.state))
          .map((m) => ({ campaign_id: c.id, milestone_id: m.id, state: m.state }))
      );
    const today = p.clock.nowIso().slice(0, 10);
    return {
      users: { total: p.identity.users.count(), by_level: usersByLevel, suspended },
      pending_approvals: {
        milestones: pendingMilestones.length,
        flagged_heritage: p.heritage.items.count((i) => i.state === 'flagged'),
        fraud_reviews: p.fraud.openReviews().length,
        failed_payouts: p.ledger.payouts.count((x) => x.state === 'failed'),
      },
      escrow: {
        count: escrows.length,
        frozen: escrows.filter((e) => e.frozen).length,
        held_minor: escrows.reduce(
          (s, e) => s + (e.funded_minor - e.released_minor - e.refunded_minor),
          0
        ),
        stuck: p.monitoring.stuckEscrows().length,
      },
      transactions: {
        postings_total: p.ledger.postings.count(),
        postings_today: p.ledger.postings.count((x) => x.ts.slice(0, 10) === today),
        trial_balance: p.ledger.trialBalance(),
        rejections: p.ledger.rejections.count(),
      },
      governance: {
        councils: p.governance.councils.count(),
        frozen_seats: p.governance.seats.count((s) => s.state === 'frozen'),
        open_disputes: p.governance.disputes.count((d) => d.state === 'open'),
        open_elections: p.governance.elections.count((e) => e.state === 'open'),
      },
      heritage: {
        total: p.heritage.items.count(),
        by_state: countBy(p.heritage.items.find(), 'state'),
        restricted: p.heritage.items.count((i) => i.visibility === 'members'),
        consents: p.heritage.consents.count(),
      },
      payments: {
        providers: [...p.payments.providers.keys()],
        intents_by_state: countBy(p.payments.intents.find(), 'state'),
        retry_queue_depth: p.payments.retryQueue.depth(),
        dead_letters: p.payments.retryQueue.deadLetters.length,
      },
      api_health: p.monitoring.readiness(),
      alerts: {
        reconciliation_variances: p.ledger.reconciliationRuns.count((r) => r.variance_minor > 0),
        webhook_rejections: p.metrics.counterValue('motse_webhooks_rejected_total') || 0,
        notification_stats: p.notifications.deliveryStats(),
      },
    };
  }));

  // ── Identity management ────────────────────────────────────────────
  router.get('/users', run((req) => {
    const query = (req.query.query || '').toLowerCase();
    const users = platform.identity.users.find((u) => {
      if (req.query.level && u.level !== req.query.level) return false;
      if (req.query.suspended === 'true' && !u.suspended) return false;
      if (!query) return true;
      return (
        u.id.toLowerCase().includes(query) ||
        (u.display_name || '').toLowerCase().includes(query) ||
        (u.ward_ref || '').toLowerCase().includes(query)
      );
    });
    return paginate(users, { pageToken: req.query.page_token, pageSize: req.query.page_size });
  }));
  router.get('/users/:id', run((req) => {
    const user = platform.identity.get(req.params.id);
    return {
      user,
      verification: platform.identity.verificationHistory(req.params.id),
      devices: user.devices,
      sessions: platform.identity.listSessions(req.params.id),
      roles: platform.identity.roles.find((g) => g.user_ref === req.params.id),
    };
  }));
  router.post('/users/:id/level', run((req) =>
    platform.identity.adminSetLevel(req.params.id, req.body.level, req.actor, req.body.reason)
  ));
  router.post('/users/:id/suspend', run((req) =>
    platform.identity.suspendUser(req.params.id, req.body.reason, req.actor)
  ));
  router.post('/users/:id/reinstate', run((req) =>
    platform.identity.reinstateUser(req.params.id, req.actor, req.body.note)
  ));
  router.post('/users/:id/institution', run((req) =>
    platform.identity.grantInstitutional(
      req.params.id,
      { institution: req.body.institution, documentRefs: req.body.document_refs },
      req.actor
    )
  ));
  router.post('/users/:id/roles', run((req) =>
    platform.identity.grantRole(req.params.id, req.body.role, req.body.scope, req.actor)
  ));
  router.post('/users/:id/roles/revoke', run((req) => {
    platform.identity.revokeRole(req.params.id, req.body.role, req.body.scope, req.actor);
    return { revoked: true };
  }));
  router.post('/users/:id/sessions/revoke', run((req) => ({
    revoked: platform.identity.revokeAllSessions(req.params.id, req.actor),
  })));
  router.post('/sessions/:sid/revoke', run((req) => ({
    revoked: platform.identity.revokeSession(req.params.sid, req.actor),
  })));
  router.get('/otp-audit', run((req) =>
    paginate(
      platform.identity.otps.find().map(({ code_hash, ...safe }) => safe),
      { pageToken: req.query.page_token, pageSize: req.query.page_size }
    )
  ));

  // ── Councils & governance ──────────────────────────────────────────
  router.get('/councils', run(() => ({
    councils: platform.governance.councils.find(),
    seats: platform.governance.seats.find(),
  })));
  router.post('/councils', run((req) =>
    platform.governance.createCouncil(req.body.morafe_ref, req.actor)
  ));
  router.post('/councils/:id/seats', run((req) =>
    platform.governance.grantSeat(
      req.params.id,
      {
        kind: req.body.kind,
        holderRef: req.body.holder_ref,
        termStart: req.body.term_start,
        termEnd: req.body.term_end,
      },
      req.actor
    )
  ));
  router.post('/seats/:id/freeze', run((req) =>
    platform.governance.freezeSeat(req.params.id, req.body.reason, req.actor)
  ));
  router.post('/seats/:id/unfreeze', run((req) =>
    platform.governance.unfreezeSeat(req.params.id, req.actor)
  ));
  router.get('/elections', run(() => platform.governance.elections.find()));
  router.post('/councils/:id/elections', run((req) =>
    platform.governance.openElection(req.params.id, req.body.seat_description, req.actor)
  ));
  router.post('/elections/:id/close', run((req) =>
    platform.governance.closeElection(req.params.id, req.actor, req.body.eligible)
  ));
  router.get('/disputes', run(() => platform.governance.disputes.find()));
  router.post('/disputes/:id/escalate', run((req) =>
    platform.governance.escalateDispute(req.params.id, req.actor)
  ));
  router.post('/disputes/:id/resolve', run((req) =>
    platform.governance.resolveDispute(req.params.id, req.body.resolution, req.actor)
  ));
  router.get('/resolutions', run(() => ({
    // Trust resolution history with quorum tracking (Letlole).
    resolutions: platform.letlole.resolutions.find().map((r) => ({
      ...r,
      signatures_count: r.signatures.length,
      quorum_met: r.signatures.length >= r.quorum,
    })),
  })));

  // ── Ledger explorer — STRICTLY READ ONLY ───────────────────────────
  router.get('/ledger/journal', run((req) => {
    const postings = platform.ledger.postings.find((posting) => {
      if (req.query.ref && posting.ref !== req.query.ref) return false;
      if (req.query.purpose && !posting.purpose.includes(req.query.purpose)) return false;
      return true;
    });
    return paginate(postings.reverse(), {
      pageToken: req.query.page_token,
      pageSize: req.query.page_size,
    });
  }));
  router.get('/ledger/trial-balance', run(() => platform.ledger.trialBalance()));
  router.get('/ledger/accounts', run((req) =>
    paginate(
      platform.ledger.accounts.find().map((account) => ({
        ...account,
        balance_minor: platform.ledger.balance(account.id),
      })),
      { pageToken: req.query.page_token, pageSize: req.query.page_size }
    )
  ));
  router.get('/ledger/escrows', run(() => platform.escrow.escrows.find()));
  router.get('/ledger/split-templates', run(() => platform.ledger.listSplitTemplates()));
  router.get('/ledger/reconciliation-runs', run(() => platform.ledger.reconciliationRuns.find()));
  router.get('/ledger/rejections', run(() => platform.ledger.rejections.find()));
  router.get('/ledger/payouts', run((req) =>
    platform.ledger.payouts.find((payout) =>
      req.query.state ? payout.state === req.query.state : true
    )
  ));
  router.get('/ledger/idempotency', run((req) =>
    paginate(
      [...platform.idempotency.entries.entries()].map(([key, entry]) => ({
        key,
        at: new Date(entry.at).toISOString(),
        outcome: entry.error ? `error:${entry.error.code}` : 'ok',
      })),
      { pageToken: req.query.page_token, pageSize: req.query.page_size }
    )
  ));

  // ── Heritage administration ────────────────────────────────────────
  router.get('/heritage/flagged', run(() =>
    platform.heritage.items.find((i) => i.state === 'flagged')
  ));
  router.get('/heritage/consents', run((req) =>
    paginate(platform.heritage.consents.find(), {
      pageToken: req.query.page_token,
      pageSize: req.query.page_size,
    })
  ));
  router.get('/heritage/deletions', run(() =>
    platform.media.items
      .find((i) => i.deleted && i.deletion)
      .map((i) => ({
        media_id: i.id,
        state: i.deletion.state,
        requested_by: i.deletion.requested_by,
        hard_delete_by: i.deletion.hard_delete_by,
        backup_purge_by: i.deletion.backup_purge_by,
        completion_receipt: i.deletion.completion_receipt || null,
      }))
  ));
  router.post('/heritage/deletion-sweep', run(() => ({
    receipts: platform.media.runDeletionSweep(),
  })));
  router.get('/heritage/restricted', run((req) => {
    // Admin access to restricted METADATA is itself an audited action
    // (§13.2 insider-access mitigations). Media/exports stay sealed:
    // there is no admin export route for this class.
    platform.audit.append(req.actor, 'admin.restricted_metadata_viewed', 'heritage:restricted',
      null, { at: platform.clock.nowIso() });
    return platform.heritage.items
      .find((i) => i.visibility === 'members' && i.state !== 'withdrawn')
      .map(({ id, type, morafe_ref, state, created_at }) => ({
        id, type, morafe_ref, state, created_at, // titles/media withheld even here
      }));
  }));

  // ── Financial administration ───────────────────────────────────────
  router.get('/finance/escrows', run(() => ({
    escrows: platform.escrow.escrows.find(),
    stuck: platform.monitoring.stuckEscrows(),
  })));
  router.get('/finance/milestones/pending', run(() =>
    platform.kgetsi.campaigns.find().flatMap((c) =>
      c.milestones
        .filter((m) => ['evidence_submitted', 'approved'].includes(m.state))
        .map((m) => ({
          campaign_id: c.id,
          campaign_title: c.title,
          class: c.class,
          milestone: m,
        }))
    )
  ));
  router.get('/finance/payments', run((req) =>
    paginate(
      platform.payments.listIntents({
        provider: req.query.provider,
        state: req.query.state,
        type: req.query.type,
      }),
      { pageToken: req.query.page_token, pageSize: req.query.page_size }
    )
  ));
  router.post('/finance/payments/:id/verify', run((req) =>
    platform.payments.verify(req.params.id)
  ));
  router.get('/finance/payouts/failed', run(() => ({
    ledger_payouts: platform.ledger.payouts.find((x) => x.state === 'failed'),
    dead_letters: platform.payments.retryQueue.deadLetters,
  })));
  router.post('/finance/retries/drain', run(() => platform.payments.drainRetries()));
  router.post('/finance/reconcile', run((req) =>
    platform.payments.reconcileDaily(req.body.provider, req.body.date)
  ));
  router.get('/finance/fraud-reviews', run(() => platform.fraud.openReviews()));
  router.post('/finance/fraud-reviews/:id/close', run((req) =>
    platform.fraud.closeReview(req.params.id, req.body.resolution, req.actor)
  ));

  // ── Audit explorer (immutable — read and verify only) ──────────────
  router.get('/audit/object/:objectRef', run((req) => ({
    entries: platform.audit.chainFor(req.params.objectRef),
    verification: platform.audit.verifyChain(req.params.objectRef),
  })));
  router.get('/audit/actor/:actorRef', run((req) =>
    paginate(
      platform.audit.events.find((e) => e.actor_ref === req.params.actorRef),
      { pageToken: req.query.page_token, pageSize: req.query.page_size }
    )
  ));
  router.get('/audit/proof/:objectRef/:entryId', run((req) => {
    const proof = platform.audit.inclusionProof(req.params.objectRef, req.params.entryId);
    return { proof, valid: AuditLog.verifyInclusion(proof) };
  }));
  router.get('/audit/export', run((req, res) => {
    // Audit entries carry actors, actions and DIGESTS — never content —
    // so this export cannot leak restricted material by construction.
    const prefix = req.query.prefix || '';
    const entries = platform.audit.events.find((e) => e.object_ref.startsWith(prefix));
    if (req.query.format === 'csv') {
      const header = 'id,ts,actor_ref,action,object_ref,prev_hash,hash';
      const rows = entries.map((e) =>
        [e.id, e.ts, e.actor_ref, e.action, e.object_ref, e.prev_hash, e.hash]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      );
      res.set('Content-Type', 'text/csv');
      res.send([header, ...rows].join('\n'));
      return undefined;
    }
    return { count: entries.length, entries };
  }));

  // ── Security & operations ──────────────────────────────────────────
  router.get('/security/denials', run(() =>
    platform.store.collection('security_denials').find()
  ));
  router.get('/security/secrets', run(() => platform.secrets.describe()));
  router.post('/security/secrets/:name/rotate', run((req) => {
    const rotated = platform.secrets.rotate(req.params.name);
    platform.audit.append(req.actor, 'security.secret_rotated', `secret:${req.params.name}`,
      null, { version: rotated.version });
    return { name: req.params.name, version: rotated.version };
  }));
  router.get('/security/permission-audit', run(() => ({
    // Permission auditing: every live grant, by role and scope.
    grants: platform.identity.roles.find(),
    suspended_grants: platform.identity.roles.find((g) => g.suspended),
  })));
  router.get('/notifications/stats', run(() => platform.notifications.deliveryStats()));
  router.post('/search/reindex', run(() => platform.search.reindex()));

  return router;
}

function countBy(rows, field) {
  const out = {};
  for (const row of rows) out[row[field]] = (out[row[field]] || 0) + 1;
  return out;
}

module.exports = { createAdminRouter };
