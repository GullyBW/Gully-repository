'use strict';

const { world, adminUser } = require('./helpers');

describe('Notification service (event-driven, §12)', () => {
  test('a settled payout notifies the wallet owner in-app and on push', () => {
    const w = world();
    const payout = w.p.ledger.requestPayout({
      accountId: w.mmaWallet.id,
      providerAccountId: w.providerClearing.id,
      amountMinor: 2500,
      msisdnRef: 'x',
      ref: 'n-payout-1',
      idempotencyKey: 'n-payout-1',
    });
    w.p.ledger.settlePayout(payout.id, 'rcpt');
    const inbox = w.p.notifications.inboxFor(w.mma.id);
    expect(inbox).toHaveLength(1);
    expect(inbox[0].title).toBe('Payout delivered');
    const deliveries = w.p.notifications.deliveries.find(
      (d) => d.notification_id === inbox[0].id
    );
    expect(deliveries.map((d) => d.channel).sort()).toEqual(['push']); // defaults: in_app + push
  });

  test('payment completion and failure notify the acting member', () => {
    const w = world();
    const intent = w.p.payments.collect({
      provider: 'orange_money',
      msisdn: '+2677',
      amountMinor: 900,
      destAccountId: w.kaboWallet.id,
      actorRef: w.kabo.id,
      idempotencyKey: 'n-c2b-1',
    });
    const hook = w.p.payments.provider('orange_money').sandboxResolve(intent.provider_ref, 'success');
    w.p.payments.processWebhook('orange_money', hook.rawBody, hook.headers);
    const inbox = w.p.notifications.inboxFor(w.kabo.id);
    expect(inbox.some((n) => n.title.includes('completed'))).toBe(true);
  });

  test('preferences: disabling push respects the choice; in-app always lands', () => {
    const w = world();
    w.p.notifications.setPreference(w.mma.id, 'payments', { push: false });
    w.p.notifications.notify(w.mma.id, { category: 'payments', title: 'Test', body: null });
    const note = w.p.notifications.inboxFor(w.mma.id)[0];
    const channels = w.p.notifications.deliveries
      .find((d) => d.notification_id === note.id)
      .map((d) => d.channel);
    expect(channels).not.toContain('push');
    expect(w.p.notifications.inboxFor(w.mma.id)).toHaveLength(1); // in-app regardless
  });

  test('civic emergency alerts override preferences AND quiet hours (§12 exemption)', () => {
    const w = world();
    // mma opts out of everything and sets 24h quiet hours.
    w.p.notifications.setPreference(w.mma.id, 'civic_emergency', { push: false, sms: false });
    w.p.notifications.setQuietHours(w.mma.id, 'civic_emergency', { start_hour: 0, end_hour: 24 });
    w.p.identity.grantRole(w.headman.id, 'government_alert_sender', `ward:${w.ward.id}`, 'system:bootstrap');
    w.p.kgotla.publishAlert(w.ward.id, w.headman.id, { severity: 'flood', body: 'Move to high ground' });

    const inbox = w.p.notifications.inboxFor(w.mma.id);
    const alert = inbox.find((n) => n.category === 'civic_emergency');
    expect(alert).toBeTruthy();
    const channels = w.p.notifications.deliveries
      .find((d) => d.notification_id === alert.id)
      .map((d) => d.channel);
    expect(channels).toEqual(expect.arrayContaining(['sms', 'push'])); // exempt category
  });

  test('quiet hours suppress push for ordinary categories, never in-app', () => {
    const w = world();
    const hour = w.p.clock.now().getUTCHours();
    w.p.notifications.setQuietHours(w.mma.id, 'ward_notices', {
      start_hour: hour,
      end_hour: (hour + 2) % 24,
    });
    w.p.kgotla.publishNotice(w.ward.id, w.headman.id, { title: 'Pitso', body: 'Saturday' });
    const note = w.p.notifications
      .inboxFor(w.mma.id)
      .find((n) => n.category === 'ward_notices');
    expect(note).toBeTruthy(); // in-app landed
    const channels = w.p.notifications.deliveries
      .find((d) => d.notification_id === note.id)
      .map((d) => d.channel);
    expect(channels).not.toContain('push');
  });

  test('whatsapp is a future adapter: opting in records an "unavailable" delivery, nothing breaks', () => {
    const w = world();
    w.p.notifications.setPreference(w.kabo.id, 'payments', { whatsapp: true });
    w.p.notifications.notify(w.kabo.id, { category: 'payments', title: 'Hi', body: null });
    const note = w.p.notifications.inboxFor(w.kabo.id)[0];
    const wa = w.p.notifications.deliveries.find(
      (d) => d.notification_id === note.id && d.channel === 'whatsapp'
    );
    expect(wa).toHaveLength(1);
    expect(wa[0].delivered).toBe(false);
    expect(wa[0].transport).toBe('unavailable');
  });

  test('reconciliation variance pages every platform admin (Sev-1, §9.2)', () => {
    const w = world();
    const opsAdmin = adminUser(w.p);
    w.p.ledger.reconcile(w.providerClearing.id, [{ ref: 'ghost', amount_minor: 4242 }]);
    const inbox = w.p.notifications.inboxFor(opsAdmin.id);
    expect(inbox.some((n) => n.title.includes('Sev-1'))).toBe(true);
  });

  test('failing transports are recorded, not thrown', () => {
    const w = require('../src/container').createPlatform({
      notificationAdapters: {
        push: { send: () => { throw new Error('FCM quota exceeded'); } },
      },
    });
    const user = w.identity.registerAnonymous('d1');
    w.notifications.notify(user.id, { category: 'payments', title: 'T', body: null });
    const delivery = w.notifications.deliveries.find((d) => d.channel === 'push')[0];
    expect(delivery.delivered).toBe(false);
    expect(delivery.error).toContain('FCM');
    expect(w.notifications.deliveryStats().by_channel.push.failed).toBe(1);
  });
});
