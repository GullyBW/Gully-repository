'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { world, adminUser, liveCampaign } = require('./helpers');

describe('Live pilot framework (WS3)', () => {
  function livePilot() {
    const w = world();
    const admin = adminUser(w.p);
    const pilot = w.p.pilots.create(
      { name: 'Serowe pilot', district: 'central', flagProfile: { 'module.mmino': true } },
      admin.id
    );
    w.p.pilots.enrollWard(pilot.id, w.ward.id, admin.id);
    w.p.pilots.assignAdmin(pilot.id, admin.id, admin.id);
    w.p.pilots.advanceStage(pilot.id, 'onboarding', admin.id);
    w.p.pilots.advanceStage(pilot.id, 'live', admin.id);
    return { w, admin, pilot };
  }

  test('morafe enrollment applies the flag profile at morafe scope', () => {
    const { w, admin, pilot } = livePilot();
    expect(w.p.flags.evaluate('module.mmino', { morafeRefs: ['bakalanga'] })).toBe(false);
    w.p.pilots.enrollMorafe(pilot.id, 'bakalanga', admin.id);
    expect(w.p.flags.evaluate('module.mmino', { morafeRefs: ['bakalanga'] })).toBe(true);
    // mma is a bakalanga member — her snapshot now shows the module.
    expect(w.p.flags.snapshotFor(w.p.identity, w.mma.id)['module.mmino']).toBe(true);
    // Idempotent.
    w.p.pilots.enrollMorafe(pilot.id, 'bakalanga', admin.id);
    expect(w.p.pilots.get(pilot.id).morafe_refs).toEqual(['bakalanga']);
  });

  test('rollback unwinds every flag override and pauses the pilot, data intact', () => {
    const { w, admin, pilot } = livePilot();
    w.p.pilots.enrollMorafe(pilot.id, 'bakalanga', admin.id);
    expect(w.p.flags.evaluate('module.mmino', { wardRef: w.ward.id })).toBe(true);
    expect(w.p.flags.evaluate('module.mmino', { morafeRefs: ['bakalanga'] })).toBe(true);

    w.p.pilots.rollback(pilot.id, admin.id, 'data-quality concerns');
    expect(w.p.pilots.get(pilot.id).stage).toBe('paused');
    expect(w.p.pilots.get(pilot.id).rolled_back.reason).toBe('data-quality concerns');
    // Every override removed → back to defaults.
    expect(w.p.flags.evaluate('module.mmino', { wardRef: w.ward.id })).toBe(false);
    expect(w.p.flags.evaluate('module.mmino', { morafeRefs: ['bakalanga'] })).toBe(false);
    // Residents and their data are untouched — only the rollout reversed.
    expect(w.p.identity.get(w.mma.id).level).toBe('L2');
    expect(w.p.audit.chainFor(`pilot:${pilot.id}`).some((e) => e.action === 'pilot.rolled_back')).toBe(true);
  });

  test('the live dashboard reports the seven operational metrics', () => {
    const { w, admin, pilot } = livePilot();
    // Generate some pilot activity.
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.mmaWallet.id, amountMinor: 2000,
      contributorRef: w.mma.id, idempotencyKey: 'pd-give',
    });
    const intent = w.p.payments.collect({
      provider: 'orange_money', msisdn: 'x', amountMinor: 500,
      destAccountId: w.mmaWallet.id, actorRef: w.mma.id, idempotencyKey: 'pd-pay',
    });
    const hook = w.p.payments.provider('orange_money').sandboxResolve(intent.provider_ref, 'success');
    w.p.payments.processWebhook('orange_money', hook.rawBody, hook.headers);
    w.p.pilots.submitFeedback(pilot.id, { userRef: w.mma.id, category: 'support', message: 'cannot log in' });

    const dashboard = w.p.pilots.liveDashboard(pilot.id);
    expect(dashboard.registration_completion.residents).toBeGreaterThanOrEqual(1);
    expect(dashboard.identity_verification_rate.verified_l2_plus).toBeGreaterThanOrEqual(1); // mma is L2
    expect(dashboard.donation_activity.contributions).toBeGreaterThanOrEqual(1);
    expect(dashboard.payment_success.success_pct).toBe(100);
    expect(dashboard.support_requests.open).toBe(1);
    expect(dashboard).toHaveProperty('offline_sync');
    expect(dashboard).toHaveProperty('booking_activity');
  });

  test('live dashboard with no activity yields null payment success and zeroes', () => {
    const { w, pilot } = livePilot();
    const dashboard = w.p.pilots.liveDashboard(pilot.id);
    expect(dashboard.payment_success.success_pct).toBeNull(); // no member intents
    expect(dashboard.donation_activity.contributions).toBe(0);
    expect(dashboard.booking_activity.bookings).toBe(0);
    expect(dashboard.support_requests.open).toBe(0);
  });

  test('a pilot service without analytics bound still produces a dashboard', () => {
    const w = world();
    const { PilotService } = require('../src/pilot/pilot.service');
    const bare = new PilotService({
      store: w.p.store, clock: w.p.clock, identity: w.p.identity,
      kgotla: w.p.kgotla, flags: w.p.flags, audit: w.p.audit, bus: w.p.bus,
    });
    const admin = adminUser(w.p);
    const pilot = bare.create({ name: 'Bare', district: 'kweneng' }, admin.id);
    bare.enrollWard(pilot.id, w.ward.id, admin.id);
    const dashboard = bare.liveDashboard(pilot.id);
    // No analytics → donation/booking/payment metrics fall back to zero/null.
    expect(dashboard.donation_activity.contributions).toBe(0);
    expect(dashboard.payment_success.success_pct).toBeNull();
    expect(dashboard.offline_sync.mutations_applied).toBe(0);
  });

  test('community feedback: members submit over HTTP; admins read it', async () => {
    const { w, admin, pilot } = livePilot();
    const { app } = createApp(w.p);
    const { sandbox_code } = w.p.identity.requestOtp('+26771000001'); // mma
    const { session } = w.p.identity.verifyOtp('+26771000001', sandbox_code, { deviceId: 'd' });
    const posted = await request(app)
      .post(`/v1/pilots/${pilot.id}/feedback`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .set('X-Device-Id', 'd')
      .set('Idempotency-Key', 'fb-1')
      .send({ category: 'request', message: 'Please add Ikalanga lessons', rating: 4 });
    expect(posted.status).toBe(200);
    expect(posted.body.category).toBe('request');
    expect(w.p.pilots.feedbackFor(pilot.id)).toHaveLength(1);
  });
});
