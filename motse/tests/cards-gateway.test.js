'use strict';

/**
 * Phase 4 (WS2/WS15) — gateway abstraction unit tests. The GatewayAdapter
 * sandbox models the full card lifecycle (tokenize → 3DS → authorize →
 * capture → refund → settle → webhook) with fault injection, and the
 * GatewayRegistry routes with capability filtering + automatic failover.
 * PCI: no PAN parameter exists anywhere in this layer.
 */
const { Clock } = require('../src/kernel/clock');
const { SecretManager } = require('../src/security/secrets');
const { GatewayAdapter } = require('../src/payments/gateways/gateway.adapter');
const {
  GATEWAY_CLASSES, StripeGateway, PeachGateway, DpoGateway, PayGateGateway,
} = require('../src/payments/gateways/adapters');
const { GatewayRegistry } = require('../src/payments/gateways/gateway.registry');

function deps() {
  const clock = new Clock();
  const secrets = new SecretManager(clock);
  return { clock, secrets };
}

function tokenOn(gw, brand = 'visa') {
  return gw.tokenize({ hostedFieldRef: 'hf_1', brand, last4: '4242', expMonth: 12, expYear: 2030 }).token;
}

/** Assert `fn` throws a MotseError with the given code; single call (fault-safe). */
function expectErr(fn, code) {
  let e;
  try { fn(); } catch (caught) { e = caught; }
  expect(e).toBeDefined();
  if (code) expect(e.code).toBe(code);
  return e;
}

describe('GatewayAdapter — capability & brand detection', () => {
  test('brandFromBin maps every configured prefix and falls back to unknown', () => {
    expect(GatewayAdapter.brandFromBin('4111111111111111')).toBe('visa');
    expect(GatewayAdapter.brandFromBin('5599')).toBe('mastercard');
    expect(GatewayAdapter.brandFromBin('5199')).toBe('mastercard');
    expect(GatewayAdapter.brandFromBin('340000')).toBe('amex');
    expect(GatewayAdapter.brandFromBin('370000')).toBe('amex');
    expect(GatewayAdapter.brandFromBin('6011000')).toBe('discover');
    expect(GatewayAdapter.brandFromBin('6500000')).toBe('discover');
    expect(GatewayAdapter.brandFromBin('9999')).toBe('unknown');
    expect(GatewayAdapter.brandFromBin('')).toBe('unknown');
    expect(GatewayAdapter.brandFromBin(null)).toBe('unknown');
  });

  test('supportsBrand / supportsCurrency reflect the configured profile', () => {
    const gw = new PeachGateway(deps());
    expect(gw.supportsBrand('visa')).toBe(true);
    expect(gw.supportsBrand('discover')).toBe(false); // Peach: no Discover
    expect(gw.supportsCurrency('ZAR')).toBe(true);
    expect(gw.supportsCurrency('UGX')).toBe(false);
  });

  test('the six concrete gateways each declare a routing profile', () => {
    expect(Object.keys(GATEWAY_CLASSES).sort()).toEqual(
      ['adyen', 'braintree', 'dpo', 'paygate', 'peach', 'stripe']
    );
    const dpo = new DpoGateway(deps());
    expect(dpo.supportsBrand('amex')).toBe(false); // DPO: visa/mastercard only
    expect(dpo.supportsCurrency('TZS')).toBe(true);
    const paygate = new PayGateGateway(deps());
    expect(paygate.supportsCurrency('ZAR')).toBe(true);
    expect(paygate.supportsCurrency('KES')).toBe(false);
  });
});

describe('GatewayAdapter — tokenization (WS3, token-only)', () => {
  test('tokenize returns a token + display metadata; a network token when asked', () => {
    const gw = new StripeGateway(deps());
    const t = gw.tokenize({ hostedFieldRef: 'hf', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2031, networkToken: true });
    expect(t.token).toMatch(/^tok_stripe_/);
    expect(t.last4).toBe('4242');
    expect(t.network_token).toMatch(/^ntk_/);
    expect(t).not.toHaveProperty('pan');
  });

  test('tokenize requires the hosted-field reference and a supported brand', () => {
    const gw = new StripeGateway(deps());
    expectErr(() => gw.tokenize({ brand: 'visa' }), 'INVALID_ARGUMENT');
    expectErr(() => gw.tokenize({ hostedFieldRef: 'hf', brand: 'jcb' }), 'INVALID_ARGUMENT');
  });

  test('customer vault links tokens; delete unlinks and forgets', () => {
    const gw = new StripeGateway(deps());
    const { customer_token: cust } = gw.createCustomer();
    const t = gw.tokenize({ hostedFieldRef: 'hf', brand: 'visa', last4: '1', customerToken: cust });
    expect(gw.customers.get(cust).tokens.has(t.token)).toBe(true);
    expect(gw.deleteToken(t.token)).toBe(true);
    expect(gw.customers.get(cust).tokens.has(t.token)).toBe(false);
    expect(gw.deleteToken('tok_missing')).toBe(false);
    // A customer token not yet in the vault is registered on first use.
    const t2 = gw.tokenize({ hostedFieldRef: 'hf', brand: 'visa', last4: '2', customerToken: 'cus_fresh' });
    expect(gw.customers.get('cus_fresh').tokens.has(t2.token)).toBe(true);
  });

  test('updateTokenExpiry mutates the stored expiry', () => {
    const gw = new StripeGateway(deps());
    const t = tokenOn(gw);
    const updated = gw.updateTokenExpiry(t, { expMonth: 6, expYear: 2035 });
    expect(updated.exp_month).toBe(6);
    expect(updated.exp_year).toBe(2035);
    expectErr(() => gw.updateTokenExpiry('tok_missing', { expMonth: 1, expYear: 2030 }), 'NOT_FOUND');
  });
});

describe('GatewayAdapter — 3-D Secure (WS4)', () => {
  test('frictionless authentication shifts liability immediately', () => {
    const gw = new StripeGateway(deps());
    const tds = gw.authenticate3DS({ token: tokenOn(gw), amountMinor: 1000, currency: 'BWP' });
    expect(tds.flow).toBe('frictionless');
    expect(tds.status).toBe('authenticated');
    expect(tds.liability_shift).toBe(true);
    expect(tds.eci).toBe('05');
  });

  test('challenge flow parks until complete3DS, then shifts liability', () => {
    const gw = new StripeGateway(deps());
    gw.faults.threeDSChallenge = true;
    const tds = gw.authenticate3DS({ token: tokenOn(gw), amountMinor: 1000, currency: 'BWP' });
    expect(tds.status).toBe('challenge_required');
    expect(tds.acs_url).toContain('/3ds/challenge/');
    const done = gw.complete3DS(tds.three_ds_ref, { success: true });
    expect(done.status).toBe('authenticated');
    expect(done.liability_shift).toBe(true);
  });

  test('a failed challenge does not shift liability', () => {
    const gw = new StripeGateway(deps());
    gw.faults.threeDSChallenge = true;
    const tds = gw.authenticate3DS({ token: tokenOn(gw), amountMinor: 1000, currency: 'BWP' });
    const failed = gw.complete3DS(tds.three_ds_ref, { success: false });
    expect(failed.status).toBe('failed');
    expect(failed.liability_shift).toBe(false);
    expect(failed.eci).toBeNull();
  });

  test('complete3DS on an unknown reference throws', () => {
    const gw = new StripeGateway(deps());
    expectErr(() => gw.complete3DS('tds_missing', { success: true }), 'NOT_FOUND');
  });
});

describe('GatewayAdapter — authorize / capture / void / refund (WS5)', () => {
  test('authorize → capture (full) marks the intent captured', () => {
    const gw = new StripeGateway(deps());
    const auth = gw.authorize({ token: tokenOn(gw), amountMinor: 5000, currency: 'BWP' });
    expect(auth.state).toBe('authorized');
    const cap = gw.capture(auth.gw_ref);
    expect(cap.state).toBe('captured');
    expect(cap.captured_minor).toBe(5000);
    expect(cap.receipt).toContain('stripe-cap-');
  });

  test('partial capture, then capture the remainder', () => {
    const gw = new StripeGateway(deps());
    const auth = gw.authorize({ token: tokenOn(gw), amountMinor: 5000, currency: 'BWP' });
    expect(gw.capture(auth.gw_ref, { amountMinor: 2000 }).state).toBe('partially_captured');
    expect(gw.capture(auth.gw_ref, { amountMinor: 3000 }).state).toBe('captured');
    expectErr(() => gw.capture(auth.gw_ref, { amountMinor: 1 }), 'STATE_CONFLICT');
  });

  test('over-capture is rejected', () => {
    const gw = new StripeGateway(deps());
    const auth = gw.authorize({ token: tokenOn(gw), amountMinor: 5000, currency: 'BWP' });
    expectErr(() => gw.capture(auth.gw_ref, { amountMinor: 6000 }), 'STATE_CONFLICT');
  });

  test('declineNext returns a hard decline (a real answer, not an outage)', () => {
    const gw = new StripeGateway(deps());
    gw.faults.declineNext = 1;
    const auth = gw.authorize({ token: tokenOn(gw), amountMinor: 5000, currency: 'BWP' });
    expect(auth.state).toBe('declined');
    expect(auth.decline_reason).toBe('DO_NOT_HONOR');
  });

  test('authorize rejects an unsupported currency and an unknown token', () => {
    const gw = new PeachGateway(deps());
    expectErr(() => gw.authorize({ token: tokenOn(gw), amountMinor: 1, currency: 'UGX' }), 'INVALID_ARGUMENT');
    expectErr(() => gw.authorize({ token: 'tok_missing', amountMinor: 1, currency: 'ZAR' }), 'NOT_FOUND');
  });

  test('void from authorized; refund only after capture', () => {
    const gw = new StripeGateway(deps());
    const auth = gw.authorize({ token: tokenOn(gw), amountMinor: 5000, currency: 'BWP' });
    expectErr(() => gw.refund(auth.gw_ref), 'STATE_CONFLICT');
    expect(gw.voidAuthorization(auth.gw_ref).state).toBe('voided');
    expectErr(() => gw.voidAuthorization(auth.gw_ref), 'STATE_CONFLICT');
  });

  test('partial then full refund; over-refund rejected', () => {
    const gw = new StripeGateway(deps());
    const auth = gw.authorize({ token: tokenOn(gw), amountMinor: 5000, currency: 'BWP' });
    gw.capture(auth.gw_ref);
    expect(gw.refund(auth.gw_ref, { amountMinor: 2000 }).state).toBe('partially_refunded');
    expectErr(() => gw.refund(auth.gw_ref, { amountMinor: 9000 }), 'STATE_CONFLICT');
    expect(gw.refund(auth.gw_ref, { amountMinor: 3000 }).state).toBe('refunded');
  });

  test('verify reports state; unknown ref is not found', () => {
    const gw = new StripeGateway(deps());
    const auth = gw.authorize({ token: tokenOn(gw), amountMinor: 5000, currency: 'BWP' });
    expect(gw.verify(auth.gw_ref)).toMatchObject({ found: true, state: 'authorized' });
    expect(gw.verify('nope')).toEqual({ found: false });
    expectErr(() => gw.capture('nope'), 'NOT_FOUND');
  });
});

describe('GatewayAdapter — settlement, webhooks, health, faults', () => {
  test('settlementFile nets refunds and excludes 3DS records', () => {
    const gw = new StripeGateway(deps());
    gw.authenticate3DS({ token: tokenOn(gw), amountMinor: 1, currency: 'BWP' }); // a 3ds record
    const auth = gw.authorize({ token: tokenOn(gw), amountMinor: 5000, currency: 'BWP', ref: 'r1' });
    gw.capture(auth.gw_ref);
    gw.refund(auth.gw_ref, { amountMinor: 1000 });
    const lines = gw.settlementFile('2026-07-04T00:00:00.000Z');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ ref: 'r1', amount_minor: 4000, currency: 'BWP', day: '2026-07-04' });
  });

  test('signWebhook produces a verifiable HMAC; parseWebhook normalises the body', () => {
    const gw = new StripeGateway(deps());
    const signed = gw.signWebhook({ gw_ref: 'auth_x', event: 'captured', amount_minor: 5000, currency: 'BWP' });
    expect(signed.headers['x-motse-signature']).toMatch(/^[0-9a-f]{64}$/);
    const parsed = gw.parseWebhook(JSON.parse(signed.rawBody));
    expect(parsed).toMatchObject({ gw_ref: 'auth_x', event: 'captured', amount_minor: 5000 });
  });

  test('health reports latency + mode; setHealthy false makes ops transient', () => {
    const gw = new StripeGateway(deps());
    gw.authorize({ token: tokenOn(gw), amountMinor: 1, currency: 'BWP' }); // record a latency
    const h = gw.health();
    expect(h).toMatchObject({ gateway: 'stripe', healthy: true, mode: 'sandbox' });
    expect(h.avg_latency_ms).toBeGreaterThanOrEqual(0);
    gw.setHealthy(false);
    const e = expectErr(() => gw.authorize({ token: tokenOn(gw), amountMinor: 1, currency: 'BWP' }));
    expect(e.transient).toBe(true);
  });

  test('timeout and transient authorize faults are marked transient', () => {
    const gw = new StripeGateway(deps());
    gw.faults.timeoutNext = 1;
    const e1 = expectErr(() => gw.authorize({ token: tokenOn(gw), amountMinor: 1, currency: 'BWP' }));
    expect(e1.transient).toBe(true);
    gw.faults.failNextAuthorize = 1;
    const e2 = expectErr(() => gw.authorize({ token: tokenOn(gw), amountMinor: 1, currency: 'BWP' }));
    expect(e2.transient).toBe(true);
  });
});

describe('GatewayRegistry — routing & failover (WS2)', () => {
  function registry(order = ['stripe', 'peach', 'dpo']) {
    const d = deps();
    const reg = new GatewayRegistry({ clock: d.clock });
    for (const name of order) reg.register(new GATEWAY_CLASSES[name](d));
    return reg;
  }

  test('register auto-appends to the order; get throws for unknown', () => {
    const reg = registry(['stripe']);
    expect(reg.order).toEqual(['stripe']);
    expectErr(() => reg.get('nope'), 'NOT_FOUND');
  });

  test('setOrder validates names', () => {
    const reg = registry(['stripe', 'peach']);
    reg.setOrder(['peach', 'stripe']);
    expect(reg.order).toEqual(['peach', 'stripe']);
    expectErr(() => reg.setOrder(['ghost']), 'INVALID_ARGUMENT');
  });

  test('candidates filter by brand + currency, in order', () => {
    const reg = registry(['stripe', 'peach', 'dpo']);
    // Discover in UGX: of these three only stripe qualifies.
    expect(reg.candidates({ brand: 'discover', currency: 'UGX' }).map((g) => g.name)).toEqual(['stripe']);
    // visa ZAR: all three qualify.
    expect(reg.candidates({ brand: 'visa', currency: 'ZAR' }).map((g) => g.name)).toEqual(['stripe', 'peach', 'dpo']);
  });

  test('route returns the first healthy candidate and logs it', () => {
    const reg = registry();
    const { result, gateway } = reg.route({ brand: 'visa', currency: 'BWP', op: 'authorize' }, (gw) => gw.name);
    expect(gateway).toBe('stripe');
    expect(result).toBe('stripe');
    expect(reg.routingLog[0]).toMatchObject({ op: 'authorize', gateway: 'stripe', outcome: 'ok' });
  });

  test('preferred gateway is tried first', () => {
    const reg = registry();
    const { gateway } = reg.route({ brand: 'visa', currency: 'ZAR', op: 'authorize', preferred: 'dpo' }, (gw) => gw.name);
    expect(gateway).toBe('dpo');
  });

  test('a transient failure fails over to the next candidate and degrades the first', () => {
    const reg = registry(['stripe', 'peach']);
    reg.get('stripe').faults.failNextAuthorize = 1;
    const { gateway } = reg.route(
      { brand: 'visa', currency: 'ZAR', op: 'authorize' },
      (gw) => gw.authorize({ token: tokenOn(gw), amountMinor: 1000, currency: 'ZAR' })
    );
    expect(gateway).toBe('peach');
    expect(reg.get('stripe')._healthy).toBe(false);
    expect(reg.routingLog.map((r) => r.outcome)).toEqual(['failover', 'ok']);
  });

  test('a hard error is NOT retried — it is the gateway’s answer', () => {
    const reg = registry(['stripe', 'peach']);
    const hardError = () => { throw new Error('validation'); };
    expect(() => reg.route({ brand: 'visa', currency: 'ZAR', op: 'authorize' }, hardError)).toThrow('validation');
    expect(reg.routingLog.pop()).toMatchObject({ outcome: 'rejected' });
  });

  test('no capable gateway throws INVALID_ARGUMENT', () => {
    const reg = registry(['peach']); // Peach routes neither Discover nor ZAR→discover
    expectErr(() => reg.route({ brand: 'discover', currency: 'ZAR', op: 'x' }, () => 1), 'INVALID_ARGUMENT');
  });

  test('every candidate transient → exhausts attempts and rethrows the last error', () => {
    const reg = registry(['stripe', 'peach', 'dpo']);
    for (const n of ['stripe', 'peach', 'dpo']) reg.get(n).setHealthy(false);
    const e = expectErr(() => reg.route({ brand: 'visa', currency: 'ZAR', op: 'x' }, (gw) => gw._assertHealthy()));
    expect(e.transient).toBe(true);
    expect(reg.routingLog.filter((r) => r.outcome === 'failover').length).toBe(3);
  });

  test('healthAll, probe (restores degraded) and describe', () => {
    const reg = registry(['stripe', 'peach']);
    reg.get('stripe').setHealthy(false);
    expect(reg.healthAll().find((h) => h.gateway === 'stripe').healthy).toBe(false);
    expect(reg.probe()).toEqual({ restored: 1 });
    expect(reg.get('stripe')._healthy).toBe(true);
    const d = reg.describe();
    expect(d).toMatchObject({ order: ['stripe', 'peach'], max_attempts: 3 });
    expect(d.gateways).toHaveLength(2);
  });

  test('constructs with all defaults; a preset order is not duplicated', () => {
    const reg = new GatewayRegistry(); // no args → order [], maxAttempts 3
    expect(reg.order).toEqual([]);
    expect(reg.maxAttempts).toBe(3);
    const reg2 = new GatewayRegistry({ clock: new Clock(), order: ['stripe'] });
    reg2.register(new GATEWAY_CLASSES.stripe(deps())); // name already in order → not re-pushed
    expect(reg2.order).toEqual(['stripe']);
  });

  test('maxAttempts 0 exhausts immediately and throws INTERNAL (no lastError)', () => {
    const d = deps();
    const reg = new GatewayRegistry({ clock: d.clock, maxAttempts: 0 });
    reg.register(new GATEWAY_CLASSES.stripe(d));
    expectErr(() => reg.route({ brand: 'visa', currency: 'BWP', op: 'x' }, () => 1), 'INTERNAL');
  });
});

describe('GatewayAdapter — default-path coverage', () => {
  test('a bare GatewayAdapter takes the default brand/currency profile', () => {
    const gw = new GatewayAdapter('test', deps()); // no options → defaults
    expect(gw.supportsBrand('visa')).toBe(true);
    expect(gw.supportsCurrency('BWP')).toBe(true);
  });

  test('live mode is reported by health', () => {
    const gw = new GATEWAY_CLASSES.stripe(deps(), { live: true, credentials: { apiKey: 'k' } });
    expect(gw.health().mode).toBe('live');
  });

  test('Adyen and Braintree construct with default options', () => {
    const adyen = new GATEWAY_CLASSES.adyen(deps());
    const braintree = new GATEWAY_CLASSES.braintree(deps());
    expect(adyen.name).toBe('adyen');
    expect(braintree.supportsBrand('amex')).toBe(true);
  });

  test('tokenize defaults last4; complete3DS and refund accept no options', () => {
    const gw = new GATEWAY_CLASSES.stripe(deps());
    const t = gw.tokenize({ hostedFieldRef: 'hf', brand: 'visa' }); // no last4 → 0000
    expect(t.last4).toBe('0000');
    gw.faults.threeDSChallenge = true;
    const tds = gw.authenticate3DS({ token: t.token, amountMinor: 1, currency: 'BWP' });
    expect(gw.complete3DS(tds.three_ds_ref).status).toBe('authenticated'); // default success:true
    const auth = gw.authorize({ token: tokenOn(gw), amountMinor: 4000, currency: 'BWP' });
    gw.capture(auth.gw_ref);
    expect(gw.refund(auth.gw_ref).state).toBe('refunded'); // full refund, no options
  });

  test('settlementFile skips an authorized-but-uncaptured intent', () => {
    const gw = new GATEWAY_CLASSES.stripe(deps());
    gw.authorize({ token: tokenOn(gw), amountMinor: 5000, currency: 'BWP', ref: 'uncaptured' });
    expect(gw.settlementFile('2026-07-04T00:00:00.000Z')).toHaveLength(0);
  });
});
