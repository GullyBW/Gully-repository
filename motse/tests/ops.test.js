'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { createPlatform } = require('../src/container');
const { world, adminUser, liveCampaign } = require('./helpers');

describe('Incident management (WS10)', () => {
  test('Sev-1 conditions auto-open incidents; recurrences dedupe into the open one', () => {
    const w = world();
    w.p.ledger.reconcile(w.providerClearing.id, [{ ref: 'ghost-1', amount_minor: 100 }]);
    w.p.ledger.reconcile(w.providerClearing.id, [{ ref: 'ghost-2', amount_minor: 100 }]);
    const incidents = w.p.ops.listIncidents();
    expect(incidents).toHaveLength(1); // deduped by source
    expect(incidents[0].severity).toBe('sev1');
    expect(incidents[0].timeline.some((t) => t.note === 'recurrence recorded')).toBe(true);
  });

  test('lifecycle: open → acknowledge → resolve, all audited, resolution required', () => {
    const w = world();
    const admin = adminUser(w.p);
    const incident = w.p.ops.openIncident(
      { severity: 'sev2', title: 'Manual drill', source: 'drill:1' },
      admin.id
    );
    w.p.ops.acknowledgeIncident(incident.id, admin.id, 'on it');
    expect(() => w.p.ops.resolveIncident(incident.id, admin.id, '')).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    const resolved = w.p.ops.resolveIncident(incident.id, admin.id, 'was the drill');
    expect(resolved.state).toBe('resolved');
    expect(w.p.audit.verifyChain(`incident:${incident.id}`).valid).toBe(true);
    // Re-resolving is a no-op; unknown severity rejected.
    expect(w.p.ops.resolveIncident(incident.id, admin.id, 'again').state).toBe('resolved');
    expect(() =>
      w.p.ops.openIncident({ severity: 'sev9', title: 'x', source: 'y' }, admin.id)
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('Maintenance mode (WS10)', () => {
  test('member mutations 503 with MAINTENANCE; reads, webhooks and admin stay up', async () => {
    const w = world();
    const admin = adminUser(w.p);
    const { app } = createApp(w.p);
    w.p.ops.setMaintenance(true, 'Nightly ledger migration', admin.id);

    const blockedWrite = await request(app)
      .post('/v1/identity/otp').set('Idempotency-Key', 'mm-1')
      .send({ msisdn: '+26771000009' });
    expect(blockedWrite.status).toBe(503);
    expect(blockedWrite.body).toMatchObject({ code: 'MAINTENANCE', retryable: true });

    const read = await request(app).get('/v1/heritage/search');
    expect(read.status).toBe(200); // reads keep serving cached packs (§15.1)

    // Money safety: operator webhooks are never rejected by maintenance.
    const intent = w.p.payments.collect({
      provider: 'orange_money', msisdn: 'x', amountMinor: 100,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'mm-pay',
    });
    const hook = w.p.payments.provider('orange_money').sandboxResolve(intent.provider_ref, 'success');
    const webhook = await request(app)
      .post('/v1/payments/webhooks/orange_money')
      .set(hook.headers).type('json').send(hook.rawBody);
    expect(webhook.status).toBe(200);

    w.p.ops.setMaintenance(false, null, admin.id);
    const restored = await request(app)
      .post('/v1/identity/otp').set('Idempotency-Key', 'mm-2')
      .send({ msisdn: '+26771000009' });
    expect(restored.status).toBe(200);
  });
});

describe('Config viewer, health and capacity reports (WS10)', () => {
  test('configView is complete and redacted — secret values never appear', () => {
    const w = world();
    const config = w.p.ops.configView();
    expect(config.payment_providers).toHaveLength(4); // + PayPal (Phase 3)
    expect(config.payment_providers[0].mode).toBe('sandbox');
    expect(config.flags.length).toBeGreaterThan(0);
    expect(config.ai_capabilities).toEqual(
      expect.arrayContaining(['translation', 'summarization', 'recommendation'])
    );
    expect(config.integrations.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(config)).not.toContain('sandbox-orange_money-secret');
  });

  test('health report rolls up readiness, incidents, money and security posture', () => {
    const w = world();
    const health = w.p.ops.healthReport();
    expect(health.readiness.ready).toBe(true);
    expect(health.trial_balance.balanced).toBe(true);
    expect(health.open_incidents).toBe(0);
    w.p.payments.retryQueue.deadLetters.push({ label: 'x' });
    expect(w.p.ops.healthReport().readiness.ready).toBe(false);
  });

  test('capacity report compares observed load to the doc §15.2 targets', () => {
    const w = world();
    w.p.clock.advance(24 * 3600 * 1000); // one day of uptime
    const capacity = w.p.ops.capacityReport();
    expect(capacity.targets.year1_mau).toBe(50000);
    expect(capacity.observed.users).toBeGreaterThan(0);
    expect(capacity.utilization.users_vs_year1_pct).toBeGreaterThan(0);
    expect(capacity.next_architecture_review_at_users).toBeGreaterThanOrEqual(250);
  });
});

describe('Backups & disaster recovery (WS10 — the restore drill)', () => {
  test('snapshot → verify → restore into a FRESH platform proves full integrity', () => {
    const w = world();
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id, amountMinor: 7000,
      contributorRef: w.kabo.id, idempotencyKey: 'dr-give',
    });
    const summary = w.p.backups.snapshot(w.p, { note: 'pre-drill' });
    expect(summary.rows).toBeGreaterThan(10);
    expect(w.p.backups.verify(summary.id)).toMatchObject({ valid: true, failures: [] });

    // The DR drill: restore into a brand-new platform instance.
    const fresh = createPlatform();
    const result = w.p.backups.restore(summary.id, fresh);
    expect(result.success).toBe(true);
    expect(result.trial_balance.balanced).toBe(true);
    expect(result.balance_mismatches).toHaveLength(0);
    expect(result.broken_audit_chains).toHaveLength(0);

    // The restored platform actually WORKS: reads and money agree.
    expect(fresh.ledger.balance(w.kaboWallet.id)).toBe(w.p.ledger.balance(w.kaboWallet.id));
    expect(fresh.kgetsi.publicLedger(campaign.id).funded_minor).toBe(7000);
    expect(fresh.audit.verifyChain(`campaign:${campaign.id}`).valid).toBe(true);
    // …and can take NEW writes on top of restored state.
    fresh.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id, amountMinor: 100,
      contributorRef: w.kabo.id, idempotencyKey: 'post-restore-give',
    });
    expect(fresh.kgetsi.publicLedger(campaign.id).funded_minor).toBe(7100);
  });

  test('backup verification fails closed on tampering; restore refuses a bad backup', () => {
    const w = world();
    const summary = w.p.backups.snapshot(w.p);
    const backup = w.p.backups.get(summary.id);
    backup.collections.ledger_postings.push({ id: 'pst_forged', entries: [], ts: 'now' });
    const verification = w.p.backups.verify(summary.id);
    expect(verification.valid).toBe(false);
    expect(verification.failures).toContain('ledger_postings');
    expect(() => w.p.backups.restore(summary.id, createPlatform())).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
    expect(() => w.p.backups.get('bak_none')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
  });

  test('backup listing carries checksums for external audit', () => {
    const w = world();
    w.p.backups.snapshot(w.p, { note: 'a' });
    w.p.backups.snapshot(w.p, { note: 'b' });
    const list = w.p.backups.list();
    expect(list).toHaveLength(2);
    expect(list[0].manifest_checksum).toHaveLength(64);
  });
});
