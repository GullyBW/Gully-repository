'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { world } = require('./helpers');

describe('Capability-based payment architecture (WS2)', () => {
  test('every provider declares the full capability matrix', () => {
    const w = world();
    const matrix = w.p.payments.capabilityMatrix();
    const byName = Object.fromEntries(matrix.map((m) => [m.provider, m]));
    // Mobile money: BWP only, no partial refunds, no multi-currency.
    expect(byName.orange_money.multi_currency).toBe(false);
    expect(byName.orange_money.currencies).toEqual(['BWP']);
    expect(byName.myzaka.refunds).toBe(false);
    // PayPal: the international rail.
    expect(byName.paypal.multi_currency).toBe(true);
    expect(byName.paypal.partial_refunds).toBe(true);
    expect(byName.paypal.chargebacks).toBe(true);
    expect(byName.paypal.currencies).toEqual(expect.arrayContaining(['USD', 'ZAR', 'BWP']));
    // The capability predicates match the matrix.
    const paypal = w.p.payments.provider('paypal');
    expect(paypal.supportsPartialRefunds()).toBe(true);
    expect(paypal.supportsSubscriptions()).toBe(true);
    expect(paypal.supportsChargebacks()).toBe(true);
    expect(w.p.payments.provider('myzaka').supportsRefunds()).toBe(false);
  });

  test('provider selection discovers a fit without provider-specific branching', () => {
    const w = world();
    // A USD partial-refundable collection → only PayPal qualifies.
    expect(w.p.payments.selectProvider({ currency: 'USD', country: 'US', needs: ['partial_refunds'] }))
      .toBe('paypal');
    // A BWP collection in Botswana → a mobile-money provider is fine.
    expect(['orange_money', 'myzaka', 'smega']).toContain(
      w.p.payments.selectProvider({ currency: 'BWP', country: 'BW' })
    );
    // Nothing supports JPY → null, not a crash.
    expect(w.p.payments.selectProvider({ currency: 'JPY' })).toBeNull();
  });

  test('capability gates enforce: no partial refund on a provider that lacks it', () => {
    const w = world();
    const intent = completedCollection(w, 'smega'); // smega: no partial refunds
    expect(() =>
      w.p.payments.refund({ intentId: intent.id, amountMinor: 100, idempotencyKey: 'sp-1' })
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('PayPal provider (WS1)', () => {
  test('order → capture → ledger deposit, in the buyer currency converted to BWP', () => {
    const w = world();
    // Diaspora donor pays USD 20.00; ledger records BWP at the FX rate.
    const intent = w.p.payments.collect({
      provider: 'paypal', amountMinor: 2000, currency: 'USD',
      destAccountId: w.kaboWallet.id, actorRef: w.kabo.id, idempotencyKey: 'pp-1',
    });
    expect(intent.currency).toBe('USD');
    expect(intent.charged_amount_minor).toBe(2000);
    expect(intent.amount_minor).toBe(Math.round(2000 * 13.5)); // BWP thebe
    expect(intent.fx_rate).toBe(13.5);
    expect(intent.state).toBe('pending_provider');

    const before = w.p.ledger.balance(w.kaboWallet.id);
    const paypal = w.p.payments.provider('paypal');
    const webhook = paypal.captureOrder(intent.provider_ref);
    const settled = w.p.payments.processWebhook('paypal', webhook.rawBody, webhook.headers);
    expect(settled.state).toBe('completed');
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(before + 27000);
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });

  test('authorize-then-capture holds before moving money', () => {
    const w = world();
    const intent = w.p.payments.collect({
      provider: 'paypal', amountMinor: 1000, currency: 'USD',
      destAccountId: w.kaboWallet.id, idempotencyKey: 'pp-auth',
    });
    const paypal = w.p.payments.provider('paypal');
    const authorized = paypal.authorizeOrder(intent.provider_ref);
    expect(authorized.state).toBe('AUTHORIZED');
    const webhook = paypal.captureOrder(intent.provider_ref);
    const settled = w.p.payments.processWebhook('paypal', webhook.rawBody, webhook.headers);
    expect(settled.state).toBe('completed');
  });

  test('partial refund is capability-allowed and capped at the remaining amount', () => {
    const w = world();
    const intent = completedCollection(w, 'paypal', { currency: 'USD', amountMinor: 5000 });
    const ledgerBwp = intent.amount_minor; // 5000 * 13.5 = 67500
    // Refund BWP 200.00 of the ~675 collected.
    const partial = w.p.payments.refund({
      intentId: intent.id, amountMinor: 20000, actorRef: w.admin.id, idempotencyKey: 'pp-r1',
    });
    expect(partial.partial).toBe(true);
    const hook = w.p.payments.provider('paypal').sandboxResolve(partial.provider_ref, 'success');
    w.p.payments.processWebhook('paypal', hook.rawBody, hook.headers);
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(100000 + ledgerBwp - 20000);

    // A second refund can't exceed what remains.
    expect(() =>
      w.p.payments.refund({ intentId: intent.id, amountMinor: ledgerBwp, idempotencyKey: 'pp-r2' })
    ).toThrow(expect.objectContaining({ code: 'STATE_CONFLICT' }));
    // But the remaining balance can be fully refunded.
    const rest = w.p.payments.refund({ intentId: intent.id, idempotencyKey: 'pp-r3' });
    const restHook = w.p.payments.provider('paypal').sandboxResolve(rest.provider_ref, 'success');
    w.p.payments.processWebhook('paypal', restHook.rawBody, restHook.headers);
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(100000);
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });

  test('chargeback reverses the deposit and opens a fraud review', () => {
    const w = world();
    const intent = completedCollection(w, 'paypal', { currency: 'USD', amountMinor: 3000 });
    const ledgerBwp = intent.amount_minor;
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(100000 + ledgerBwp);

    const paypal = w.p.payments.provider('paypal');
    const disputeHook = paypal.sandboxChargeback(intent.provider_ref, { reasonCode: 'UNAUTHORIZED' });
    const result = w.p.payments.processWebhook('paypal', disputeHook.rawBody, disputeHook.headers);
    expect(result.state).toBe('charged_back');
    expect(w.p.ledger.balance(w.kaboWallet.id)).toBe(100000); // money clawed back
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
    expect(w.p.fraud.openReviews().some((r) => r.check === 'chargeback')).toBe(true);
    // A second chargeback webhook can't double-reverse.
    expect(() => w.p.payments.processChargeback(intent.id, {})).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
  });

  test('a non-multicurrency provider refuses a foreign-currency collection', () => {
    const w = world();
    expect(() =>
      w.p.payments.collect({
        provider: 'orange_money', amountMinor: 1000, currency: 'USD',
        destAccountId: w.kaboWallet.id, idempotencyKey: 'mm-usd',
      })
    ).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  test('PayPal reconciliation matches captured orders in the statement', () => {
    const w = world();
    const intent = completedCollection(w, 'paypal', { currency: 'USD', amountMinor: 1500 });
    void intent;
    const report = w.p.payments.reconcileDaily('paypal', w.p.clock.nowIso());
    expect(report.provider).toBe('paypal');
    expect(report.matched).toBeGreaterThanOrEqual(1);
    expect(report.variance_minor).toBe(0);
  });

  test('HTTP: capability matrix, order capture and selection are exposed', async () => {
    const w = world();
    const { app } = createApp(w.p);
    const providers = await request(app).get('/v1/payments/providers');
    expect(providers.body.providers.map((p) => p.provider)).toContain('paypal');
    const select = await request(app).get('/v1/payments/select?currency=USD&country=US&needs=chargebacks');
    expect(select.body.provider).toBe('paypal');

    // Full order capture over HTTP.
    const { sandbox_code } = w.p.identity.requestOtp('+26771000002');
    const { session } = w.p.identity.verifyOtp('+26771000002', sandbox_code, { deviceId: 'd' });
    const intent = w.p.payments.collect({
      provider: 'paypal', amountMinor: 1000, currency: 'USD',
      destAccountId: w.kaboWallet.id, actorRef: w.kabo.id, idempotencyKey: 'pp-http',
    });
    const capture = await request(app)
      .post(`/v1/payments/paypal/orders/${intent.provider_ref}/capture`)
      .set('Authorization', `Bearer ${session.access_token}`)
      .set('X-Device-Id', 'd')
      .set('Idempotency-Key', 'pp-cap-1')
      .send({});
    expect(capture.body.state).toBe('completed');
  });
});

function completedCollection(w, providerName, { currency = 'BWP', amountMinor = 1000 } = {}) {
  const intent = w.p.payments.collect({
    provider: providerName, msisdn: '+2677', amountMinor, currency,
    destAccountId: w.kaboWallet.id, actorRef: w.kabo.id,
    idempotencyKey: `cc-${providerName}-${currency}-${Math.random()}`,
  });
  if (providerName === 'paypal') {
    const hook = w.p.payments.provider('paypal').captureOrder(intent.provider_ref);
    w.p.payments.processWebhook('paypal', hook.rawBody, hook.headers);
  } else {
    const hook = w.p.payments.provider(providerName).sandboxResolve(intent.provider_ref, 'success');
    w.p.payments.processWebhook(providerName, hook.rawBody, hook.headers);
  }
  return w.p.payments.intent(intent.id);
}
