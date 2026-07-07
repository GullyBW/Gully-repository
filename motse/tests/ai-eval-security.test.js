'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { world, adminUser } = require('./helpers');
const { tokenF1 } = require('../src/ai/evaluation/evaluator');

describe('AI evaluation framework (WS9)', () => {
  test('produces a graded, thresholded quality report over the local providers', () => {
    const w = world();
    const report = w.p.aiEvaluator.evaluate('test');
    // The default local providers are registered, so every metric runs.
    for (const metric of ['translation', 'search', 'recommendation', 'summarization', 'tagging']) {
      expect(report.metrics[metric].n).toBeGreaterThan(0);
      expect(report.metrics[metric]).toHaveProperty('score');
      expect(report.metrics[metric]).toHaveProperty('pass');
    }
    // The shipped baseline providers clear their thresholds.
    expect(report.metrics.translation.pass).toBe(true);
    expect(report.metrics.search.pass).toBe(true);
    expect(report.metrics.summarization.pass).toBe(true);
    expect(report.passed).toBe(true);
    // The evaluation is audited (every AI release is measurable).
    expect(w.p.audit.events.find((e) => e.action === 'ai.evaluation')).toHaveLength(1);
  });

  test('token-F1 rewards exact matches and penalises misses', () => {
    expect(tokenF1('hello madam', 'hello madam')).toBe(1);
    expect(tokenF1('hello', 'hello madam')).toBeCloseTo(0.667, 2);
    expect(tokenF1('completely wrong', 'hello madam')).toBe(0);
  });

  test('a regressed provider fails its threshold', () => {
    const w = world();
    const { AiProvider } = require('../src/ai/registry');
    class BadTranslator extends AiProvider {
      constructor() { super('bad-translate', 'translation'); }
      run() { return { translation: 'zzz', from: 'tn', to: 'en', quality: 'broken' }; }
    }
    w.p.ai.register(new BadTranslator()); // supersedes the baseline
    const report = w.p.aiEvaluator.evaluate('test');
    expect(report.metrics.translation.pass).toBe(false);
    expect(report.passed).toBe(false);
  });

  test('HTTP: admins pull the AI evaluation report', async () => {
    const w = world();
    const { app } = createApp(w.p, { adminBootstrapToken: 'tb' });
    const session = await adminSession(w, app, '+26771944001');
    const res = await session(request(app).get('/v1/admin/ai/evaluation'));
    expect(res.status).toBe(200);
    expect(res.body.metrics.translation).toBeDefined();
  });
});

describe('Security scorecard (WS8)', () => {
  test('a healthy platform grades A with the money and audit controls passing', () => {
    const w = world();
    const card = w.p.securityScorecard.generate();
    expect(card.score).toBeGreaterThanOrEqual(85);
    expect(['A', 'B']).toContain(card.grade);
    const controls = Object.fromEntries(card.controls.map((c) => [c.name, c.ok]));
    expect(controls.ledger_balanced).toBe(true);
    expect(controls.audit_chains_intact).toBe(true);
  });

  test('the grade drops when controls fail (overdue rotation + open Sev-1)', () => {
    const w = world();
    const admin = adminUser(w.p);
    w.p.clock.advance(91 * 24 * 3600 * 1000); // rotation overdue
    w.p.ops.openIncident({ severity: 'sev1', title: 'drill', source: 'drill:x' }, admin.id);
    const card = w.p.securityScorecard.generate();
    expect(card.failing).toEqual(
      expect.arrayContaining(['secrets_rotation_current', 'no_open_high_incidents'])
    );
    expect(card.score).toBeLessThan(95);
  });

  test('tampering with the audit log fails the integrity control', () => {
    const w = world();
    const { publishedItem } = require('./helpers');
    const item = publishedItem(w);
    const chain = w.p.audit.chainFor(`heritage:${item.id}`);
    w.p.audit.events.update(chain[0].id, { action: 'tampered' });
    const card = w.p.securityScorecard.generate();
    expect(card.controls.find((c) => c.name === 'audit_chains_intact').ok).toBe(false);
  });
});

describe('Automated penetration tests (WS8) — app-layer probes', () => {
  let w;
  let app;
  let session;
  let deviceId = 'pen-device';

  beforeEach(async () => {
    w = world();
    ({ app } = createApp(w.p));
    const otp = w.p.identity.requestOtp('+26771955001');
    const verified = w.p.identity.verifyOtp('+26771955001', otp.sandbox_code, { deviceId });
    session = verified.session;
  });

  const authed = (r) => r.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', deviceId);

  test('forged JWT signature is rejected', async () => {
    const [payload] = session.access_token.split('.');
    const forged = `${payload}.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef`;
    const res = await request(app).get('/v1/wallet/accounts')
      .set('Authorization', `Bearer ${forged}`).set('X-Device-Id', deviceId);
    expect(res.status).toBe(401);
  });

  test('token replay from a different device is rejected (device binding)', async () => {
    const res = await request(app).get('/v1/wallet/accounts')
      .set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'attacker');
    expect(res.status).toBe(401);
  });

  test('IDOR: a member cannot read another member private booking itinerary', async () => {
    const experience = w.p.loeto.createExperience(w.mma.id, {
      title: 'x', priceMinor: 1000,
      splitTemplate: { name: 't', version: 1, shares: [{ account_id: w.mmaWallet.id, pct: 100 }] },
    });
    const booking = w.p.loeto.book(experience.id, w.mma.id, {
      sourceAccountId: w.mmaWallet.id, idempotencyKey: 'pen-book',
    });
    // The authenticated user is +26771955001, not mma → not their booking.
    const res = await authed(request(app).get(`/v1/loeto/bookings/${booking.id}/ics`));
    expect(res.status).toBe(403);
  });

  test('missing idempotency key on a mutation is refused', async () => {
    const res = await authed(request(app).post('/v1/ledger/accounts')).send({ type: 'user_wallet' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  test('restricted heritage probe returns MEMBERSHIP_REQUIRED, never content', async () => {
    const { publishedItem } = require('./helpers');
    const item = publishedItem(w, { visibility: 'members', title: 'Sacred' });
    const res = await authed(request(app).get(`/v1/heritage/items/${item.id}`));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('MEMBERSHIP_REQUIRED');
    expect(JSON.stringify(res.body)).not.toContain('Sacred');
  });

  test('unauthenticated admin access is denied and recorded', async () => {
    const res = await request(app).get('/v1/admin/dashboard');
    expect(res.status).toBe(401);
    expect(w.p.store.collection('security_denials').count()).toBeGreaterThan(0);
  });

  test('privilege escalation: a plain member cannot reach admin endpoints', async () => {
    const res = await authed(request(app).get('/v1/admin/security/scorecard'));
    expect([401, 403]).toContain(res.status);
  });
});

async function adminSession(w, app, msisdn) {
  await request(app).post('/v1/admin/bootstrap')
    .set('Idempotency-Key', `bs-${msisdn}`).set('X-Bootstrap-Token', 'tb').send({ msisdn });
  const otp = await request(app).post('/v1/identity/otp')
    .set('Idempotency-Key', `o-${msisdn}`).send({ msisdn });
  const verified = await request(app).post('/v1/identity/otp/verify')
    .set('Idempotency-Key', `v-${msisdn}`).set('X-Device-Id', 'admin-d')
    .send({ msisdn, code: otp.body.sandbox_code });
  const token = verified.body.session.access_token;
  return (r) => r.set('Authorization', `Bearer ${token}`).set('X-Device-Id', 'admin-d');
}
