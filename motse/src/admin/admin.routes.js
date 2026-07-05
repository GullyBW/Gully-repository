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

  // ── Phase 2: pilot management & feature flags (WS7) ────────────────
  router.get('/pilots', run(() => platform.pilots.list()));
  router.post('/pilots', run((req) =>
    platform.pilots.create(
      { name: req.body.name, district: req.body.district, flagProfile: req.body.flag_profile },
      req.actor
    )
  ));
  router.post('/pilots/:id/stage', run((req) =>
    platform.pilots.advanceStage(req.params.id, req.body.stage, req.actor)
  ));
  router.post('/pilots/:id/villages', run((req) =>
    platform.pilots.registerVillage(
      req.params.id,
      { name: req.body.name, wardName: req.body.ward_name, headmanMsisdn: req.body.headman_msisdn },
      req.actor
    )
  ));
  router.post('/pilots/:id/wards', run((req) =>
    platform.pilots.enrollWard(req.params.id, req.body.ward_ref, req.actor)
  ));
  router.post('/pilots/:id/admins', run((req) =>
    platform.pilots.assignAdmin(req.params.id, req.body.user_ref, req.actor)
  ));
  router.get('/pilots/:id/health', run((req) => platform.pilots.health(req.params.id)));
  router.get('/pilots/:id/report', run((req) => platform.pilots.report(req.params.id)));
  router.get('/pilots/:id/dashboard', run((req) => platform.pilots.liveDashboard(req.params.id)));
  router.post('/pilots/:id/morafe', run((req) =>
    platform.pilots.enrollMorafe(req.params.id, req.body.morafe_ref, req.actor)
  ));
  router.post('/pilots/:id/rollback', run((req) =>
    platform.pilots.rollback(req.params.id, req.actor, req.body.reason)
  ));
  router.get('/pilots/:id/feedback', run((req) => platform.pilots.feedbackFor(req.params.id)));
  router.get('/flags', run(() => platform.flags.list()));
  router.post('/flags/:key', run((req) => {
    if (req.body.define) {
      platform.flags.define(req.params.key, {
        description: req.body.description,
        defaultValue: req.body.default_value,
        kind: req.body.kind,
      });
    }
    if (req.body.scope !== undefined) {
      return platform.flags.set(req.params.key, req.body.scope, req.body.value, req.actor);
    }
    return platform.flags.definition(req.params.key);
  }));
  router.post('/flags/:key/unset', run((req) => ({
    removed: platform.flags.unset(req.params.key, req.body.scope, req.actor),
  })));

  // ── Phase 2: analytics (WS5 — aggregates only, no PII) ─────────────
  router.get('/analytics/dashboard', run(() => platform.analytics.dashboard()));

  // ── Phase 2: security assurance (WS6) ──────────────────────────────
  router.get('/security/events', run((req) =>
    platform.assurance.listEvents({ severity: req.query.severity, type: req.query.type })
  ));
  router.get('/security/report', run(() => platform.assurance.report()));
  router.post('/security/holds/:userRef/release', run((req) => ({
    released: platform.assurance.releaseHold(req.params.userRef, req.actor),
  })));
  router.get('/security/device-risk/:userRef', run((req) =>
    platform.assurance.deviceRisk(req.params.userRef, req.query.device_id)
  ));
  router.post('/security/rotation/run', run((req) => ({
    rotated: platform.assurance.runRotation(req.actor),
  })));

  // ── Phase 2: operations (WS10) ─────────────────────────────────────
  router.get('/ops/incidents', run((req) => platform.ops.listIncidents({ state: req.query.state })));
  router.post('/ops/incidents', run((req) => platform.ops.openIncident(req.body, req.actor)));
  router.post('/ops/incidents/:id/ack', run((req) =>
    platform.ops.acknowledgeIncident(req.params.id, req.actor, req.body.note)
  ));
  router.post('/ops/incidents/:id/resolve', run((req) =>
    platform.ops.resolveIncident(req.params.id, req.actor, req.body.resolution)
  ));
  router.post('/ops/incidents/:id/notes', run((req) =>
    platform.ops.addTimelineNote(req.params.id, req.actor, req.body.note)
  ));
  router.post('/ops/maintenance', run((req) =>
    platform.ops.setMaintenance(req.body.on, req.body.message, req.actor)
  ));
  router.get('/ops/center', run(() => platform.ops.operationsCenter())); // WS10 unified view
  router.get('/ops/diagnostics', run(() => platform.ops.diagnostics()));
  router.post('/ops/maintenance/schedule', run((req) =>
    platform.ops.scheduleMaintenance(req.body.starts_at, req.body.ends_at, req.body.message, req.actor)
  ));
  router.get('/ops/config', run(() => platform.ops.configView()));
  router.get('/ops/health-report', run(() => platform.ops.healthReport()));
  router.get('/ops/capacity', run(() => platform.ops.capacityReport()));
  router.post('/ops/backups', run((req) => {
    const summary = platform.backups.snapshot(platform, { note: req.body.note });
    platform.audit.append(req.actor, 'ops.backup_created', `backup:${summary.id}`, null, {
      manifest_checksum: summary.manifest_checksum,
    });
    return summary;
  }));
  router.get('/ops/backups', run(() => platform.backups.list()));
  router.post('/ops/backups/:id/verify', run((req) => platform.backups.verify(req.params.id)));

  // ── Phase 3: developer platform oversight (WS12) ───────────────────
  router.get('/developer/apps', run(() =>
    platform.developer.apps.find().map((a) => {
      const { key_hash, webhook_secret, ...safe } = a;
      return safe;
    })
  ));
  router.get('/developer/subscriptions', run(() => platform.developer.subscriptions.find()));
  router.get('/developer/deliveries', run((req) =>
    paginate(platform.developer.deliveries.find(), {
      pageToken: req.query.page_token, pageSize: req.query.page_size,
    })
  ));
  router.post('/developer/deliveries/retry', run(() => platform.developer.retryFailedDeliveries()));

  // ── Phase 3: AI evaluation (WS9) + security scorecard (WS8) ────────
  router.get('/ai/evaluation', run((req) => platform.aiEvaluator.evaluate(req.actor)));
  router.get('/security/scorecard', run(() => platform.securityScorecard.generate()));

  // ── Phase 3: plugin management (WS5) ───────────────────────────────
  router.get('/plugins', run(() => platform.plugins.list()));
  router.post('/plugins/:name/enable', run((req) => platform.plugins.enable(req.params.name, req.actor)));
  router.post('/plugins/:name/disable', run((req) => platform.plugins.disable(req.params.name, req.actor)));

  // ── Phase 3: workflow engine (WS4) ─────────────────────────────────
  router.get('/workflows', run(() => platform.workflows.listDefinitions()));
  router.post('/workflows', run((req) => platform.workflows.defineWorkflow(req.body, req.actor)));
  router.get('/workflows/instances', run((req) =>
    paginate(
      platform.workflows.instances.find((i) => (req.query.state ? i.state === req.query.state : true)),
      { pageToken: req.query.page_token, pageSize: req.query.page_size }
    )
  ));
  router.get('/workflows/instances/:id', run((req) => platform.workflows.get(req.params.id)));
  router.post('/workflows/:key/start', run((req) =>
    platform.workflows.start(req.params.key, {
      context: req.body.context || {},
      objectRef: req.body.object_ref,
      actor: req.actor,
    })
  ));
  router.post('/workflows/instances/:id/steps/:stepId/decide', run((req) =>
    platform.workflows.decide(req.params.id, req.params.stepId, req.actor, {
      decision: req.body.decision,
      note: req.body.note,
    })
  ));
  router.post('/workflows/instances/:id/steps/:stepId/delegate', run((req) =>
    platform.workflows.delegate(req.params.id, req.params.stepId, req.actor, req.body.to_ref, req.actor)
  ));
  router.post('/workflows/tick', run(() => platform.workflows.tick()));

  // ── Phase 2: integrations (WS9) ────────────────────────────────────
  router.get('/integrations', run(() => platform.integrations.describe()));
  router.post('/integrations/gov-id/verify', run((req) => {
    const result = platform.integrations.get('gov_identity').verifyNationalId({
      omang: req.body.omang,
      fullName: req.body.full_name,
      dob: req.body.dob,
    });
    platform.audit.append(req.actor, 'integrations.gov_id_checked', `user:${req.body.user_ref || 'unknown'}`,
      null, { verified: result.verified });
    return result;
  }));
  router.get('/integrations/gis/geocode', run((req) =>
    platform.integrations.get('gis').geocode(req.query.name)
  ));

  // ── Phase 4: card payments operations portal (WS11) ────────────────
  // Transaction Explorer (redacted — never a token/PAN).
  router.get('/cards/intents', run((req) =>
    paginate(
      platform.cards.listIntents({ state: req.query.state, gateway: req.query.gateway }),
      { pageToken: req.query.page_token, pageSize: req.query.page_size }
    )
  ));
  router.get('/cards/intents/:id', run((req) => platform.cards.intentDetail(req.params.id)));
  // Merchant operations: capture / void / refund.
  router.post('/cards/intents/:id/capture', run((req) =>
    platform.cards.capture(req.params.id, { amountMinor: req.body.amount_minor, actorRef: req.actor })
  ));
  router.post('/cards/intents/:id/void', run((req) =>
    platform.cards.voidAuthorization(req.params.id, { actorRef: req.actor })
  ));
  // Refund Manager.
  router.post('/cards/intents/:id/refund', run((req) =>
    platform.cards.refund(req.params.id, {
      amountMinor: req.body.amount_minor, reason: req.body.reason, actorRef: req.actor,
    })
  ));
  // Chargeback intake (also arrives via signed webhook).
  router.post('/cards/intents/:id/chargeback', run((req) =>
    platform.cards.processChargeback(req.params.id, { reasonCode: req.body.reason_code, actorRef: req.actor })
  ));
  // Dispute Management.
  router.get('/cards/disputes', run(() => platform.cards.openDisputes()));
  router.post('/cards/disputes/:id/evidence', run((req) =>
    platform.cards.submitDisputeEvidence(req.params.id, req.body.evidence_refs, req.actor)
  ));
  router.post('/cards/disputes/:id/resolve', run((req) =>
    platform.cards.resolveDispute(req.params.id, req.body.outcome, req.actor)
  ));
  // Settlement & reconciliation.
  router.post('/cards/reconcile', run((req) => platform.cards.reconcile(req.body.date)));
  router.get('/cards/settlements', run(() => platform.cards.settlements.find()));
  // Subscriptions: run the billing scheduler on demand.
  router.post('/cards/subscriptions/run-billing', run(() => platform.cards.runBilling()));
  // Gateway status / health / failover dashboard.
  router.get('/cards/gateways', run(() => platform.gateways.describe()));
  router.post('/cards/gateways/order', run((req) => {
    platform.gateways.setOrder(req.body.order);
    return platform.gateways.describe();
  }));
  router.post('/cards/gateways/probe', run(() => platform.gateways.probe()));
  router.post('/cards/gateways/:name/health', run((req) => {
    platform.gateways.get(req.params.name).setHealthy(req.body.healthy !== false);
    return platform.gateways.get(req.params.name).health();
  }));
  // Provider configuration + capability matrix.
  router.get('/cards/config', run(() => ({
    provider: platform.cardProvider.describeCapabilities(),
    gateways: platform.cards.gatewayCapabilities(),
  })));
  // Card analytics (aggregates only — no PII, no card data).
  router.get('/cards/analytics', run(() => platform.analytics.cardAnalytics()));

  // ── Phase 5: Event Store (WS2) ─────────────────────────────────────
  router.get('/events', run((req) =>
    paginate(
      platform.eventStore.read({
        stream: req.query.stream, type: req.query.type, tenant: req.query.tenant, until: req.query.until,
      }),
      { pageToken: req.query.page_token, pageSize: req.query.page_size }
    )
  ));
  router.get('/events/stats', run(() => platform.eventStore.stats()));
  router.get('/events/timetravel', run((req) =>
    paginate(platform.eventStore.timeTravel(req.query.at, { stream: req.query.stream }), {
      pageToken: req.query.page_token, pageSize: req.query.page_size,
    })
  ));

  // ── Phase 5: CQRS projections (WS3) — dashboards read these ────────
  router.get('/projections', run(() => platform.projections.list()));
  router.get('/projections/:name', run((req) => platform.projections.view(req.params.name)));
  router.post('/projections/:name/rebuild', run((req) => ({ state: platform.projections.rebuild(req.params.name) })));

  // ── Phase 5: QR Code Platform (WS21) ───────────────────────────────
  router.get('/qr', run((req) =>
    paginate(platform.qr.list({ kind: req.query.kind, tenant: req.query.tenant, state: req.query.state }), {
      pageToken: req.query.page_token, pageSize: req.query.page_size,
    })
  ));
  router.get('/qr/report', run(() => platform.qr.report()));
  router.get('/qr/:id/scans', run((req) => platform.qr.scanHistory(req.params.id)));
  router.post('/qr/:id/revoke', run((req) => platform.qr.revoke(req.actor, req.params.id, req.body.reason)));
  router.post('/qr/bulk', run((req) => ({ codes: platform.qr.bulkGenerate(req.actor, req.body.items || []) })));

  // ── Phase 6: governed DPI planes ───────────────────────────────────
  // Policy Decision Kernel — evaluate a decision (ops/testing).
  router.post('/policy/decide', run((req) => platform.policy.decide({
    assertion: platform.identityPlane.assert(req.body.subject || null, { tenant: req.body.tenant }),
    tenant: req.body.tenant,
    action: req.body.action,
    resource: req.body.resource || null,
    riskScore: req.body.risk_score || 0,
    context: { correlationId: req.traceId },
  })));
  // Cross-plane audit graph (forensic tracing + compliance rollup).
  router.get('/audit/graph/:correlationId', run((req) => platform.auditGraph.trace(req.params.correlationId)));
  router.get('/audit/planes', run(() => platform.auditGraph.summary()));
  // Data Product Plane (projections/analytics only — authorized + signed).
  router.get('/data-products', run(() => platform.dataProducts.list()));
  router.get('/data-products/:name', run((req) =>
    platform.dataProducts.read(req.params.name, { subject: req.actor, correlationId: req.traceId })
  ));
  // Governed AI corpus ingestion (classified content).
  router.post('/ai/corpus', run((req) => platform.aiGateway.addDocument(req.actor, {
    tenant: req.body.tenant, classification: req.body.classification,
    requiredRole: req.body.required_role, requiredLevel: req.body.required_level,
    requiredMorafe: req.body.required_morafe, title: req.body.title, content: req.body.content,
  })));
  // Cell-based sovereign topology.
  router.get('/cells', run(() => platform.cells.describe()));
  router.get('/cells/:id/contract', run((req) => platform.cells.contract(req.params.id)));
  // DPI Certification Mode — signed, reproducible compliance report.
  router.post('/certification/run', run(() => platform.certification.run()));

  // ── Foundation F2/F3: outbox + distributed runtime ─────────────────
  router.get('/outbox', run(() => platform.outbox.stats()));
  router.get('/outbox/dead-letters', run(() => platform.outbox.deadLetters()));
  router.post('/outbox/drain', run(() => platform.outbox.drain()));
  router.post('/outbox/dead-letters/:id/replay', run((req) => platform.outbox.replayDead(req.params.id)));
  router.get('/distributed', run(() => ({
    kv: platform.kv.constructor.name,
    redis_backed: platform.kv.constructor.name === 'RedisKvAdapter',
    services: ['idempotency', 'rateLimiter', 'lock'],
  })));

  // ── Phase 2/3: observability (tracing + health) ────────────────────
  router.get('/observability/traces', run((req) => platform.tracer.recent(Number(req.query.limit) || 20)));
  router.get('/observability/traces/:traceId', run((req) => platform.tracer.trace(req.params.traceId)));
  router.get('/observability/tracer', run(() => platform.tracer.stats()));
  router.get('/observability/health', run(() => platform.health.ready()));

  return router;
}

function countBy(rows, field) {
  const out = {};
  for (const row of rows) out[row[field]] = (out[row[field]] || 0) + 1;
  return out;
}

module.exports = { createAdminRouter };
