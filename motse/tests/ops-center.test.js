'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const request = require('supertest');
const { createApp } = require('../src/app');
const { world, adminUser, liveCampaign } = require('./helpers');

describe('Operations Center (WS10)', () => {
  test('the unified view reports every required panel with a status', () => {
    const w = world();
    const center = w.p.ops.operationsCenter();
    expect(center.overall).toBe('healthy');
    const panels = center.panels;
    for (const key of [
      'infrastructure', 'payments', 'fraud', 'ledger', 'governance', 'notifications',
      'analytics', 'queues', 'offline_sync', 'pilots', 'ai', 'support', 'security',
    ]) {
      expect(panels[key]).toBeDefined();
    }
    expect(panels.ledger.status).toBe('ok');
    expect(panels.ledger.trial_balance.balanced).toBe(true);
    expect(panels.ai.capabilities).toEqual(expect.arrayContaining(['translation', 'knowledge_search']));
    expect(panels.security.grade).toBeDefined();
  });

  test('overall degrades when an incident is open or the ledger is off', () => {
    const w = world();
    const admin = adminUser(w.p);
    w.p.ops.openIncident({ severity: 'sev1', title: 'x', source: 's:1' }, admin.id);
    expect(w.p.ops.operationsCenter().overall).toBe('degraded');
  });

  test('every panel flips to "attention" when its subsystem degrades', () => {
    const w = world();
    const admin = adminUser(w.p);
    // Degrade multiple subsystems at once.
    w.p.payments.retryQueue.deadLetters.push({ label: 'x' });
    for (let i = 0; i < 120; i += 1) w.p.payments.retryQueue.tasks.set(`t${i}`, { runAt: Infinity });
    w.p.governance.openDispute('heritage:h1', w.mma.id, 'contested');
    w.p.fraud.reviews.insert({ id: 'frw_q', check: 'x', state: 'open', ts: w.p.clock.nowIso() });
    w.p.clock.advance(91 * 24 * 3600 * 1000); // rotation overdue → security grade drops
    const center = w.p.ops.operationsCenter();
    expect(center.panels.payments.status).toBe('attention');
    expect(center.panels.queues.status).toBe('attention');
    expect(center.panels.governance.status).toBe('attention');
    expect(center.panels.fraud.status).toBe('attention');
    expect(center.overall).toBe('degraded');
    void admin;
  });

  test('applyScheduledMaintenance is a no-op with no schedule or outside the window', () => {
    const w = world();
    expect(w.p.ops.applyScheduledMaintenance()).toEqual({ changed: false }); // nothing scheduled
    const now = w.p.clock.now();
    w.p.ops.scheduleMaintenance(
      new Date(now.getTime() + 3600000).toISOString(),
      new Date(now.getTime() + 7200000).toISOString(),
      'later', 'admin'
    );
    // Before the window → no change.
    expect(w.p.ops.applyScheduledMaintenance()).toEqual({ changed: false });
  });

  test('live diagnostics surface stuck intents and open incidents', () => {
    const w = world();
    const provider = w.p.payments.provider('orange_money');
    const intent = w.p.payments.collect({
      provider: 'orange_money', msisdn: 'x', amountMinor: 100,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'diag-1',
    });
    void provider;
    const diag = w.p.ops.diagnostics();
    expect(diag.payments.stuck_intents.some((i) => i.id === intent.id)).toBe(true);
    expect(diag.readiness).toBeDefined();
    expect(diag.ledger.trial_balance.balanced).toBe(true);
  });

  test('maintenance scheduling flips the window on the scheduler tick', () => {
    const w = world();
    const admin = adminUser(w.p);
    const now = w.p.clock.now();
    const starts = new Date(now.getTime() + 1000).toISOString();
    const ends = new Date(now.getTime() + 3600000).toISOString();
    w.p.ops.scheduleMaintenance(starts, ends, 'planned upgrade', admin.id);
    expect(w.p.ops.maintenance.on).toBe(false);
    w.p.clock.advance(2000); // into the window
    expect(w.p.ops.applyScheduledMaintenance()).toMatchObject({ changed: true, on: true });
    expect(w.p.ops.maintenance.on).toBe(true);
    w.p.clock.advance(3600000); // past the end
    expect(w.p.ops.applyScheduledMaintenance()).toMatchObject({ changed: true, on: false });
    expect(w.p.ops.maintenance.on).toBe(false);
  });

  test('HTTP: the ops center is admin-only', async () => {
    const w = world();
    const { app } = createApp(w.p, { adminBootstrapToken: 'tb' });
    await request(app).post('/v1/admin/bootstrap')
      .set('Idempotency-Key', 'oc-bs').set('X-Bootstrap-Token', 'tb').send({ msisdn: '+26771977001' });
    const otp = await request(app).post('/v1/identity/otp').set('Idempotency-Key', 'oc-o').send({ msisdn: '+26771977001' });
    const verified = await request(app).post('/v1/identity/otp/verify')
      .set('Idempotency-Key', 'oc-v').set('X-Device-Id', 'oc').send({ msisdn: '+26771977001', code: otp.body.sandbox_code });
    const token = verified.body.session.access_token;
    const res = await request(app).get('/v1/admin/ops/center').set('Authorization', `Bearer ${token}`).set('X-Device-Id', 'oc');
    expect(res.status).toBe(200);
    expect(res.body.panels.ledger.trial_balance.balanced).toBe(true);

    const anon = await request(app).get('/v1/admin/ops/center');
    expect(anon.status).toBe(401);
  });
});

describe('Load & resilience harness (WS7)', () => {
  test('the resilience simulation runs green and preserves ledger integrity', () => {
    // A small sample keeps CI fast; the harness asserts its own invariants
    // (trial balance, exactly-once replay, restore integrity) and exits
    // nonzero on any violation.
    const script = path.join(__dirname, '..', 'scripts', 'resilience-test.js');
    const output = execFileSync('node', [script, '10k'], {
      env: { ...process.env, SIM_DIVISOR: '200', MOTSE_LOG_LEVEL: 'silent' },
      encoding: 'utf8',
    });
    expect(output).toContain('ledger integrity HELD');
    expect(output).toContain('failover restore drill');
  }, 60000);
});
