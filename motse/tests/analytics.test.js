'use strict';

const { world, liveCampaign, publishedItem } = require('./helpers');
const { AnalyticsService } = require('../src/analytics/analytics.service');

describe('Analytics platform (WS5) — aggregates only, never PII', () => {
  test('DAU/MAU from hashed request telemetry; feature usage per day', () => {
    const w = world();
    w.p.analytics.recordRequest('/v1/kgetsi/campaigns', w.kabo.id, 200);
    w.p.analytics.recordRequest('/v1/kgetsi/campaigns', w.kabo.id, 200); // same user, once in DAU
    w.p.analytics.recordRequest('/v1/heritage/search', w.mma.id, 200);
    w.p.analytics.recordRequest('/v1/heritage/items/x', w.mma.id, 403); // failures ≠ usage
    expect(w.p.analytics.activeUsers()).toBe(2);
    expect(w.p.analytics.featureUsage()).toEqual({ kgetsi: 2, heritage: 1 });

    // MAU: a user active 20 days ago still counts; 40 days ago does not.
    const early = new AnalyticsService({ clock: w.p.clock, bus: w.p.bus, platform: w.p });
    early.recordRequest('/v1/puo/courses', 'usr_old', 200);
    w.p.clock.advance(20 * 24 * 3600 * 1000);
    early.recordRequest('/v1/puo/courses', 'usr_recent', 200);
    const activity = early.activity();
    expect(activity.mau).toBe(2);
    expect(activity.series).toHaveLength(30);
    w.p.clock.advance(20 * 24 * 3600 * 1000);
    expect(early.activity().mau).toBe(1); // usr_old aged out of the window
  });

  test('funnels: verification, payment conversion and provider success rates', () => {
    const w = world();
    const conversion = w.p.analytics.verificationConversion();
    expect(conversion.by_level.L2).toBeGreaterThanOrEqual(1); // mma
    expect(conversion.l0_to_l1_pct).toBeGreaterThan(0);

    // Payment funnel: one completes, one fails.
    const ok = w.p.payments.collect({
      provider: 'orange_money', msisdn: 'x', amountMinor: 100,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'an-1',
    });
    const okHook = w.p.payments.provider('orange_money').sandboxResolve(ok.provider_ref, 'success');
    w.p.payments.processWebhook('orange_money', okHook.rawBody, okHook.headers);
    const bad = w.p.payments.collect({
      provider: 'smega', msisdn: 'x', amountMinor: 100,
      destAccountId: w.kaboWallet.id, idempotencyKey: 'an-2',
    });
    const badHook = w.p.payments.provider('smega').sandboxResolve(bad.provider_ref, 'failure');
    w.p.payments.processWebhook('smega', badHook.rawBody, badHook.headers);

    const payment = w.p.analytics.paymentConversion();
    expect(payment.initiated).toBe(2);
    expect(payment.conversion_pct).toBe(50);
    const rates = w.p.analytics.providerSuccessRates();
    expect(rates.orange_money.success_pct).toBe(100);
    expect(rates.smega.success_pct).toBe(0);
    expect(rates.myzaka.success_pct).toBeNull(); // no traffic
  });

  test('the dashboard aggregates every WS5 requirement and contains no raw user ids', () => {
    const w = world();
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id, amountMinor: 500,
      contributorRef: w.kabo.id, idempotencyKey: 'an-3',
    });
    publishedItem(w);
    w.p.analytics.trackSearch('tsodilo pula stories');
    w.p.analytics.trackSearch('tsodilo rock art');
    w.p.analytics.recordRequest('/v1/sync/outbox', w.kabo.id, 200);

    const dashboard = w.p.analytics.dashboard();
    expect(dashboard.activity.dau_today).toBeGreaterThanOrEqual(1);
    expect(dashboard.escrow_completion.campaigns).toBe(1);
    expect(dashboard.heritage.published_today).toBe(1);
    expect(dashboard.offline.sync_batches_today).toBe(1);
    expect(dashboard.search.queries_today).toBe(2);
    expect(dashboard.search.top_terms[0].term).toBe('tsodilo');
    expect(dashboard.notifications.delivery).toHaveProperty('by_channel');
    expect(dashboard.tourism).toHaveProperty('bookings');

    // PII rule: no pseudonymous user id ever appears in analytics output.
    const serialized = JSON.stringify(dashboard);
    for (const user of w.p.identity.users.find()) {
      expect(serialized).not.toContain(user.id);
    }
  });

  test('pilot usage counts residents active today without exposing who they are', () => {
    const w = world();
    w.p.analytics.recordRequest('/v1/kgotla/x', w.mma.id, 200); // mma lives in the ward
    w.p.analytics.recordRequest('/v1/kgotla/x', w.kabo.id, 200); // kabo has no ward
    const usage = w.p.analytics.pilotUsage([w.ward.id]);
    expect(usage.residents).toBe(1);
    expect(usage.active_today).toBe(1);
    expect(JSON.stringify(usage)).not.toContain(w.mma.id);
  });

  test('domain events feed lifetime counters (letsema channel split, notifications)', () => {
    const w = world();
    const letsema = w.p.kgotla.createLetsema(w.ward.id, w.mma.id, { title: 'x', date: 'y' });
    w.p.kgotla.joinLetsema(letsema.id, w.kabo.id, { channel: 'ussd' });
    const dashboard = w.p.analytics.dashboard();
    expect(dashboard.offline.letsema_joins_via_ussd_sms).toBe(1);
  });
});
