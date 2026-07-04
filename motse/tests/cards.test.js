'use strict';

/**
 * Phase 4 (WS5–WS10, WS13/WS15) — CardService lifecycle. Exercises saved
 * cards, payment intents, 3-D Secure, capture/void, refund, chargebacks &
 * disputes, settlement/reconciliation, subscriptions, card fraud, secure
 * webhooks and card analytics — always asserting the Ledger stays the
 * single balanced source of truth and that no token/PAN ever leaks.
 */
const { world } = require('./helpers');

function merchant(p, type = 'community_trust') {
  return p.ledger.openAccount('merchant:demo', type).id;
}

function saved(p, ownerRef, over = {}) {
  return p.cards.saveCard(ownerRef, {
    hostedFieldRef: `hf_${Math.random().toString(16).slice(2)}`,
    brand: 'visa', last4: '4242', expMonth: 12, expYear: 2030, ...over,
  });
}

function expectErr(fn, code) {
  let e;
  try { fn(); } catch (caught) { e = caught; }
  expect(e).toBeDefined();
  if (code) expect(e.code).toBe(code);
  return e;
}

let intentSeq = 0;
function authorizedIntent(p, ownerRef, dest, over = {}) {
  const card = over.card || saved(p, ownerRef);
  intentSeq += 1;
  return p.cards.createIntent(ownerRef, {
    amountMinor: 25000, currency: 'BWP', destAccountId: dest, cardId: card.id,
    idempotencyKey: `it-${intentSeq}-${Math.random()}`, ...over,
  });
}

describe('Saved payment methods (WS6) — token-only, masked only', () => {
  test('first card becomes default; only a token + display metadata is stored', () => {
    const w = world();
    const card = saved(w.p, w.kabo.id, { last4: '4242' });
    expect(card.display).toBe('Visa **** **** **** 4242');
    expect(card.logo).toBe('/assets/card/visa.svg');
    expect(card.is_default).toBe(true);
    expect(JSON.stringify(card)).not.toContain('tok_'); // never the token
    // The stored row keeps ONLY a token, never a PAN/CVV.
    const row = w.p.cards.cards.get(card.id);
    expect(row.gateway_token).toMatch(/^tok_/);
    expect(row).not.toHaveProperty('pan');
    expect(row).not.toHaveProperty('cvv');
  });

  test('second card is not default and reuses the gateway customer vault', () => {
    const w = world();
    const first = saved(w.p, w.kabo.id);
    const second = saved(w.p, w.kabo.id);
    expect(second.is_default).toBe(false);
    const rows = w.p.cards.cards.find((c) => c.owner_ref === w.kabo.id);
    expect(rows[0].customer_token).toBe(rows[1].customer_token); // same vault
    expect(w.p.cards.listCards(w.kabo.id)).toHaveLength(2);
  });

  test('setDefault switches the default flag exactly once', () => {
    const w = world();
    const a = saved(w.p, w.kabo.id);
    const b = saved(w.p, w.kabo.id);
    w.p.cards.setDefaultCard(w.kabo.id, b.id);
    const cards = w.p.cards.listCards(w.kabo.id);
    expect(cards.find((c) => c.id === a.id).is_default).toBe(false);
    expect(cards.find((c) => c.id === b.id).is_default).toBe(true);
  });

  test('updateCard changes nickname and expiry (expiry pushed to the gateway)', () => {
    const w = world();
    const card = saved(w.p, w.kabo.id);
    const updated = w.p.cards.updateCard(w.kabo.id, card.id, { nickname: 'Travel', expMonth: 6, expYear: 2035 });
    expect(updated.nickname).toBe('Travel');
    expect(updated.exp_month).toBe(6);
    expect(updated.exp_year).toBe(2035);
  });

  test('replaceToken swaps the gateway token but keeps the card id', () => {
    const w = world();
    const card = saved(w.p, w.kabo.id);
    const before = w.p.cards.cards.get(card.id).gateway_token;
    const out = w.p.cards.replaceToken(w.kabo.id, card.id, { hostedFieldRef: 'hf_new', last4: '1111' });
    expect(out.id).toBe(card.id);
    expect(out.last4).toBe('1111');
    expect(w.p.cards.cards.get(card.id).gateway_token).not.toBe(before);
  });

  test('deleteCard soft-deletes, forgets the token and promotes the next card', () => {
    const w = world();
    const a = saved(w.p, w.kabo.id);
    const b = saved(w.p, w.kabo.id);
    expect(w.p.cards.deleteCard(w.kabo.id, a.id)).toEqual({ deleted: true });
    expect(w.p.cards.cards.get(a.id).gateway_token).toBeNull();
    expect(w.p.cards.listCards(w.kabo.id).find((c) => c.id === b.id).is_default).toBe(true);
  });

  test('ownership is enforced; unknown cards are NOT_FOUND', () => {
    const w = world();
    const card = saved(w.p, w.kabo.id);
    expectErr(() => w.p.cards.setDefaultCard(w.mma.id, card.id), 'PERMISSION_DENIED');
    expectErr(() => w.p.cards.deleteCard(w.kabo.id, 'card_missing'), 'NOT_FOUND');
  });

  test('explicit gateway + nickname, nickname-only update, defaulted token replacement', () => {
    const w = world();
    // Explicit gateway + custom nickname (not the derived default).
    const card = w.p.cards.saveCard(w.kabo.id, {
      hostedFieldRef: 'hf', brand: 'visa', last4: '4242', gateway: 'peach', nickname: 'Holiday',
    });
    expect(card.gateway).toBe('peach');
    expect(card.nickname).toBe('Holiday');
    // Nickname-only update skips the gateway expiry call.
    expect(w.p.cards.updateCard(w.kabo.id, card.id, { nickname: 'Renamed' }).nickname).toBe('Renamed');
    // Expiry-only update defaults the missing half from the stored card.
    const exp = w.p.cards.updateCard(w.kabo.id, card.id, { expMonth: 9 });
    expect(exp.exp_month).toBe(9);
    // Token replacement defaulting every optional field from the card.
    expect(w.p.cards.replaceToken(w.kabo.id, card.id, { hostedFieldRef: 'hf2' }).last4).toBe('4242');
  });

  test('deleting the only card leaves no default to promote', () => {
    const w = world();
    const only = saved(w.p, w.kabo.id);
    expect(w.p.cards.deleteCard(w.kabo.id, only.id)).toEqual({ deleted: true });
    expect(w.p.cards.listCards(w.kabo.id)).toHaveLength(0);
  });
});

describe('Payment intent + 3-D Secure (WS4/WS5)', () => {
  test('frictionless authentication authorizes immediately, redacted', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    expect(intent.state).toBe('authorized');
    expect(intent.gateway_token).toBeUndefined(); // redacted
    expect(intent.gateway_token_masked).toMatch(/^\*\*\*\*/);
    expect(intent.gateway_token_masked).not.toContain('tok_');
    expect(intent.gw_ref).toBeTruthy();
  });

  test('a challenge parks in requires_action; complete3DS authorizes', () => {
    const w = world();
    const dest = merchant(w.p);
    for (const gw of w.p.gateways.gateways.values()) gw.faults.threeDSChallenge = true;
    const card = saved(w.p, w.kabo.id);
    const intent = w.p.cards.createIntent(w.kabo.id, {
      amountMinor: 5000, destAccountId: dest, cardId: card.id, idempotencyKey: 'ch-1',
    });
    expect(intent.state).toBe('requires_action');
    const done = w.p.cards.complete3DS(intent.id); // default success:true
    expect(done.state).toBe('authorized');
  });

  test('a failed challenge declines the intent', () => {
    const w = world();
    const dest = merchant(w.p);
    for (const gw of w.p.gateways.gateways.values()) gw.faults.threeDSChallenge = true;
    const card = saved(w.p, w.kabo.id);
    const intent = w.p.cards.createIntent(w.kabo.id, {
      amountMinor: 5000, destAccountId: dest, cardId: card.id, idempotencyKey: 'ch-2',
    });
    const failed = w.p.cards.complete3DS(intent.id, { success: false });
    expect(failed.state).toBe('declined');
    expectErr(() => w.p.cards.complete3DS(intent.id, { success: true }), 'STATE_CONFLICT');
  });

  test('a hard gateway decline fails the intent', () => {
    const w = world();
    const dest = merchant(w.p);
    for (const gw of w.p.gateways.gateways.values()) gw.faults.declineNext = 1;
    const card = saved(w.p, w.kabo.id);
    const intent = w.p.cards.createIntent(w.kabo.id, {
      amountMinor: 5000, destAccountId: dest, cardId: card.id, idempotencyKey: 'dec-1',
    });
    expect(intent.state).toBe('declined');
    expect(intent.failure_reason).toBeTruthy();
  });

  test('createIntent accepts a raw token+brand (no saved card)', () => {
    const w = world();
    const dest = merchant(w.p);
    // Tokenize directly to obtain a gateway token (as hosted fields would).
    const gw = w.p.gateways.get('stripe');
    const tok = gw.tokenize({ hostedFieldRef: 'hf', brand: 'visa', last4: '9', expMonth: 1, expYear: 2030 }).token;
    const intent = w.p.cards.createIntent(w.kabo.id, {
      amountMinor: 5000, destAccountId: dest, token: tok, brand: 'visa', idempotencyKey: 'tok-1',
    });
    expect(intent.state).toBe('authorized');
  });

  test('idempotency returns the same (redacted) intent; guards on inputs', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    const a = w.p.cards.createIntent(w.kabo.id, { amountMinor: 5000, destAccountId: dest, cardId: card.id, idempotencyKey: 'idem-x' });
    const b = w.p.cards.createIntent(w.kabo.id, { amountMinor: 5000, destAccountId: dest, cardId: card.id, idempotencyKey: 'idem-x' });
    expect(b.id).toBe(a.id);
    expect(b.gateway_token).toBeUndefined();
    expectErr(() => w.p.cards.createIntent(w.kabo.id, { amountMinor: 1, destAccountId: dest, cardId: card.id }), 'IDEMPOTENCY_KEY_REQUIRED');
    expectErr(() => w.p.cards.createIntent(w.kabo.id, { amountMinor: 1, destAccountId: 'acc_missing', cardId: card.id, idempotencyKey: 'k' }), 'NOT_FOUND');
    expectErr(() => w.p.cards.createIntent(w.kabo.id, { amountMinor: 1, destAccountId: dest, idempotencyKey: 'k2' }), 'INVALID_ARGUMENT');
  });

  test('a review-worthy amount flags the intent for review but still authorizes', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    // BWP 6,000 (600000 thebe) is over the large-amount review threshold.
    const intent = w.p.cards.createIntent(w.kabo.id, {
      amountMinor: 600000, destAccountId: dest, cardId: card.id, idempotencyKey: 'rev-1',
    });
    expect(intent.state).toBe('authorized');
    expect(w.p.cards.intent(intent.id).review).toBe(true);
  });

  test('a transient authorization failure (all gateways) declines via the catch path', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    // 3-D Secure succeeds, but every gateway then throws on authorize →
    // the registry exhausts its attempts and _authorize fails the intent.
    for (const gw of w.p.gateways.gateways.values()) gw.faults.failNextAuthorize = 1;
    const intent = w.p.cards.createIntent(w.kabo.id, {
      amountMinor: 5000, destAccountId: dest, cardId: card.id, idempotencyKey: 'tr-1',
    });
    expect(intent.state).toBe('declined');
    expect(intent.failure_reason).toBeTruthy();
  });

  test('multi-currency (WS8): original currency, rate, timestamp and BWP amount are stored', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    const intent = w.p.cards.createIntent(w.kabo.id, {
      amountMinor: 1000, currency: 'USD', destAccountId: dest, cardId: card.id, idempotencyKey: 'fx-1',
    });
    expect(intent.original_currency).toBe('USD');
    expect(intent.settlement_currency).toBe('BWP');
    expect(intent.fx_rate).toBe(13.5);
    expect(intent.charged_amount_minor).toBe(1000);
    expect(intent.amount_minor).toBe(13500); // 1000 * 13.5, BWP thebe
    expect(intent.fx_timestamp).toBeTruthy();
  });
});

describe('Capture / partial capture / void / refund (WS5) — ledger is truth', () => {
  test('full capture credits the destination via a balanced ledger posting', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    const cap = w.p.cards.capture(intent.id, { idempotencyKey: 'cap-1' });
    expect(cap.state).toBe('captured');
    expect(w.p.ledger.balance(dest)).toBe(25000);
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });

  test('partial capture then the remainder; wrong-state capture rejected', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    expect(w.p.cards.capture(intent.id, { amountMinor: 10000, idempotencyKey: 'pc-1' }).state).toBe('partially_captured');
    expect(w.p.ledger.balance(dest)).toBe(10000);
    expect(w.p.cards.capture(intent.id, { amountMinor: 15000, idempotencyKey: 'pc-2' }).state).toBe('captured');
    expect(w.p.ledger.balance(dest)).toBe(25000);
    expectErr(() => w.p.cards.capture(intent.id, { idempotencyKey: 'pc-3' }), 'STATE_CONFLICT');
  });

  test('lifecycle default arguments: capture/refund with no options; token intent without brand', () => {
    const w = world();
    const dest = merchant(w.p);
    // A raw token with no brand supplied → cardBrand defaults to visa.
    const tok = w.p.gateways.get('stripe').tokenize({ hostedFieldRef: 'hf', brand: 'visa', last4: '7' }).token;
    const intent = w.p.cards.createIntent(w.kabo.id, { amountMinor: 8000, destAccountId: dest, token: tok, idempotencyKey: 'df-1' });
    expect(intent.brand).toBe('visa');
    // capture() and refund() with no options object → all defaults, incl. keys.
    expect(w.p.cards.capture(intent.id).state).toBe('captured');
    expect(w.p.ledger.balance(dest)).toBe(8000);
    expect(w.p.cards.refund(intent.id).state).toBe('refunded');
    expect(w.p.ledger.balance(dest)).toBe(0);
  });

  test('void releases an authorization; cannot void after capture-complete', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    expect(w.p.cards.voidAuthorization(intent.id).state).toBe('voided');
    expectErr(() => w.p.cards.voidAuthorization(intent.id), 'STATE_CONFLICT');
  });

  test('multi-currency capture converts back to BWP for the ledger', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    const intent = w.p.cards.createIntent(w.kabo.id, {
      amountMinor: 1000, currency: 'USD', destAccountId: dest, cardId: card.id, idempotencyKey: 'fxcap',
    });
    w.p.cards.capture(intent.id, { idempotencyKey: 'fxcap-c' });
    expect(w.p.ledger.balance(dest)).toBe(13500);
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });

  test('refund: partial, then full; over-refund and non-captured are rejected', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    expectErr(() => w.p.cards.refund(intent.id, {}), 'STATE_CONFLICT'); // not captured yet
    w.p.cards.capture(intent.id, { idempotencyKey: 'rc-1' });
    expect(w.p.cards.refund(intent.id, { amountMinor: 10000, idempotencyKey: 'rf-1' }).state).toBe('partially_refunded');
    expect(w.p.ledger.balance(dest)).toBe(15000);
    expectErr(() => w.p.cards.refund(intent.id, { amountMinor: 999999, idempotencyKey: 'rf-x' }), 'STATE_CONFLICT');
    expect(w.p.cards.refund(intent.id, { idempotencyKey: 'rf-2' }).state).toBe('refunded');
    expect(w.p.ledger.balance(dest)).toBe(0);
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
  });
});

describe('Chargebacks, disputes & settlement (WS5)', () => {
  function captured(w, dest) {
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    w.p.cards.capture(intent.id, { idempotencyKey: `c-${intent.id}` });
    return intent;
  }

  test('chargeback claws back via the ledger and opens a dispute', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = captured(w, dest);
    const dispute = w.p.cards.processChargeback(intent.id, { reasonCode: 'FRAUD' });
    expect(dispute.state).toBe('open');
    expect(w.p.ledger.balance(dest)).toBe(0); // clawed back
    expect(w.p.cards.intent(intent.id).state).toBe('charged_back');
    expect(w.p.ledger.trialBalance().balanced).toBe(true);
    // Idempotent: a repeat returns the intent, no double clawback.
    expect(w.p.cards.processChargeback(intent.id).state).toBe('charged_back');
  });

  test('cannot charge back with nothing captured', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    expectErr(() => w.p.cards.processChargeback(intent.id), 'STATE_CONFLICT');
  });

  test('dispute evidence → resolve won re-credits; lost does not', () => {
    const w = world();
    const dest = merchant(w.p);
    const won = w.p.cards.processChargeback(captured(w, dest).id);
    expect(w.p.cards.submitDisputeEvidence(won.id, ['receipt.pdf'], w.admin.id).state).toBe('evidence_submitted');
    expectErr(() => w.p.cards.submitDisputeEvidence(won.id, [], w.admin.id), 'STATE_CONFLICT'); // already submitted
    w.p.cards.resolveDispute(won.id, 'won', w.admin.id);
    expect(w.p.ledger.balance(dest)).toBe(25000); // re-credited
    expect(w.p.ledger.trialBalance().balanced).toBe(true);

    const dest2 = merchant(w.p);
    const lost = w.p.cards.processChargeback(captured(w, dest2).id);
    w.p.cards.resolveDispute(lost.id, 'lost', w.admin.id);
    expect(w.p.ledger.balance(dest2)).toBe(0); // stays clawed back
    expectErr(() => w.p.cards.resolveDispute(lost.id, 'maybe', w.admin.id), 'INVALID_ARGUMENT');
  });

  test('reconcile matches captured settlement lines and records a run', () => {
    const w = world();
    const dest = merchant(w.p);
    captured(w, dest);
    const report = w.p.cards.reconcile('2026-07-04T00:00:00.000Z');
    expect(report.settlement_id).toMatch(/^cst_/);
    expect(report.matched).toBeGreaterThanOrEqual(1);
    expect(w.p.cards.settlements.find()).toHaveLength(1);
  });

  test('reconcile converts a foreign-currency settlement line back to BWP', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    const intent = w.p.cards.createIntent(w.kabo.id, { amountMinor: 1000, currency: 'USD', destAccountId: dest, cardId: card.id, idempotencyKey: 'rec-fx' });
    w.p.cards.capture(intent.id, { idempotencyKey: 'rec-fx-c' });
    const report = w.p.cards.reconcile('2026-07-04T00:00:00.000Z');
    expect(report.variance_minor).toBe(0); // 1000 USD line → 13500 BWP matches the posting
  });
});

describe('Secure card webhooks (WS10)', () => {
  function capturedIntent(w, dest) {
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    w.p.cards.capture(intent.id, { idempotencyKey: `wc-${intent.id}` });
    return intent;
  }
  const post = (w, gwName, body, over = {}) => {
    const signed = w.p.gateways.get(gwName).signWebhook(body);
    return w.p.cards.processWebhook(gwName, signed.rawBody, { ...signed.headers, ...over });
  };

  test('a signed chargeback webhook routes to the ledger clawback', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = capturedIntent(w, dest);
    const out = post(w, intent.gateway, { gw_ref: intent.gw_ref, event: 'chargeback', amount_minor: 25000, currency: 'BWP', reason_code: 'FRAUD' });
    expect(out.state).toBe('open'); // a dispute was opened
    expect(w.p.ledger.balance(dest)).toBe(0);
  });

  test('a non-chargeback event is acknowledged', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = capturedIntent(w, dest);
    const out = post(w, intent.gateway, { gw_ref: intent.gw_ref, event: 'captured', amount_minor: 25000, currency: 'BWP' });
    expect(out).toMatchObject({ acknowledged: true, intent_id: intent.id });
  });

  test('bad signature, replayed nonce, duplicate and unknown-ref are all handled', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = capturedIntent(w, dest);
    const signed = w.p.gateways.get(intent.gateway).signWebhook({ gw_ref: intent.gw_ref, event: 'captured', amount_minor: 25000, currency: 'BWP' });
    // Bad signature.
    expectErr(() => w.p.cards.processWebhook(intent.gateway, signed.rawBody, { ...signed.headers, 'x-motse-signature': 'deadbeef' }), 'PERMISSION_DENIED');
    // Good delivery, then a replay of the SAME nonce is rejected.
    expect(w.p.cards.processWebhook(intent.gateway, signed.rawBody, signed.headers)).toMatchObject({ acknowledged: true });
    expectErr(() => w.p.cards.processWebhook(intent.gateway, signed.rawBody, signed.headers), 'PERMISSION_DENIED');
    // A fresh delivery of the same event (new nonce) is a duplicate no-op.
    expect(post(w, intent.gateway, { gw_ref: intent.gw_ref, event: 'captured', amount_minor: 25000, currency: 'BWP' })).toEqual({ duplicate: true });
    // Unknown gateway ref.
    expectErr(() => post(w, intent.gateway, { gw_ref: 'auth_ghost', event: 'captured' }), 'NOT_FOUND');
  });
});

describe('Subscriptions & recurring (WS7)', () => {
  test('create → billing charges the due cycle and captures to the ledger', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    const sub = w.p.cards.createSubscription(w.kabo.id, { cardId: card.id, amountMinor: 5000, destAccountId: dest, interval: 'monthly', plan: 'donation' });
    expect(sub.state).toBe('active');
    w.p.clock.advance(31 * 24 * 3600 * 1000); // past the next charge
    const out = w.p.cards.runBilling();
    expect(out.charged).toBe(1);
    expect(w.p.ledger.balance(dest)).toBe(5000);
    expect(w.p.cards.listSubscriptions(w.kabo.id)[0].charges).toBe(1);
  });

  test('validates interval and destination', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    expectErr(() => w.p.cards.createSubscription(w.kabo.id, { cardId: card.id, amountMinor: 1, destAccountId: dest, interval: 'hourly' }), 'INVALID_ARGUMENT');
    expectErr(() => w.p.cards.createSubscription(w.kabo.id, { cardId: card.id, amountMinor: 1, destAccountId: 'acc_x', interval: 'monthly' }), 'NOT_FOUND');
  });

  test('a failing charge goes past_due then cancels after the grace window', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    const sub = w.p.cards.createSubscription(w.kabo.id, { cardId: card.id, amountMinor: 5000, destAccountId: dest, interval: 'monthly', graceDays: 1 });
    // Force every gateway to hard-decline each attempted charge.
    for (const gw of w.p.gateways.gateways.values()) gw.faults.declineNext = 9;
    w.p.clock.advance(31 * 24 * 3600 * 1000);
    let out = w.p.cards.runBilling();
    expect(out.past_due).toBe(1);
    expect(w.p.cards.subscription ? 0 : w.p.cards.listSubscriptions(w.kabo.id)[0].state).toBe('past_due');
    // Next retry is beyond the 1-day grace → cancel.
    w.p.clock.advance(2 * 24 * 3600 * 1000);
    out = w.p.cards.runBilling();
    expect(out.cancelled).toBe(1);
    expect(w.p.cards.listSubscriptions(w.kabo.id)[0].state).toBe('cancelled');
  });

  test('pause / resume / cancel transitions and their guards', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    const sub = w.p.cards.createSubscription(w.kabo.id, { cardId: card.id, amountMinor: 5000, destAccountId: dest, interval: 'monthly' });
    expect(w.p.cards.pauseSubscription(w.kabo.id, sub.id).state).toBe('paused');
    expectErr(() => w.p.cards.resumeSubscription(w.mma.id, sub.id), 'PERMISSION_DENIED');
    expect(w.p.cards.resumeSubscription(w.kabo.id, sub.id).state).toBe('active');
    expect(w.p.cards.cancelSubscription(w.kabo.id, sub.id).state).toBe('cancelled');
    expectErr(() => w.p.cards.pauseSubscription(w.kabo.id, sub.id), 'STATE_CONFLICT');
  });

  test('proration and changePlan compute the mid-cycle delta', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    const sub = w.p.cards.createSubscription(w.kabo.id, { cardId: card.id, amountMinor: 5000, destAccountId: dest, interval: 'monthly' });
    const proration = w.p.cards.prorate(sub.id, 10000);
    expect(proration).toHaveProperty('net_minor');
    expect(proration.fraction).toBeGreaterThan(0);
    const changed = w.p.cards.changePlan(w.kabo.id, sub.id, { amountMinor: 10000, plan: 'membership' });
    expect(changed.subscription.amount_minor).toBe(10000);
    expect(changed.proration).not.toBeNull();
    // changePlan with no amount → no proration, plan keeps its current value.
    const planOnly = w.p.cards.changePlan(w.kabo.id, sub.id, {});
    expect(planOnly.proration).toBeNull();
    expect(planOnly.subscription.amount_minor).toBe(10000);
    expect(planOnly.subscription.plan).toBe('membership');
  });
});

describe('Card fraud (WS9) — plugged into the existing engine', () => {
  const ctx = (over) => ({ kind: 'card_payment', actorRef: 'u1', amountMinor: 100, ...over });

  test('card testing (many small charges) is denied, and blocks a real intent', () => {
    const w = world();
    const dest = merchant(w.p);
    for (let i = 0; i < 8; i += 1) w.p.fraud.assess(ctx({ amountMinor: 100 }));
    const card = saved(w.p, 'u1'); // owner u1 to match fraud actor
    // The 9th assessment (inside createIntent) trips card_testing → deny.
    expectErr(() => w.p.cards.createIntent('u1', { amountMinor: 100, destAccountId: dest, cardId: card.id, idempotencyKey: 'ct' }), 'PERMISSION_DENIED');
    const denied = w.p.fraud.events.find((e) => e.flags.some((f) => f.check === 'card_testing' && f.action === 'deny'));
    expect(denied.length).toBeGreaterThanOrEqual(1);
  });

  test('BIN abuse, duplicate-card, high-risk country and repeated chargebacks flag review', () => {
    const w = world();
    // BIN abuse: 5 distinct BINs for one actor.
    let flags;
    for (let i = 0; i < 5; i += 1) flags = w.p.fraud.assess(ctx({ actorRef: 'bin', bin: `bin${i}` }));
    expect(flags.some((f) => f.check === 'bin_abuse')).toBe(true);
    // Duplicate card: one token used by three accounts.
    let dup;
    for (const a of ['a', 'b', 'c']) dup = w.p.fraud.assess(ctx({ actorRef: a, token: 'tok_shared' }));
    expect(dup.some((f) => f.check === 'duplicate_card')).toBe(true);
    // High-risk country.
    expect(w.p.fraud.assess(ctx({ actorRef: 'hr', country: 'XX' })).some((f) => f.check === 'high_risk_country')).toBe(true);
    // Repeated chargebacks.
    w.p.fraud.assess({ kind: 'card_chargeback', actorRef: 'cb', amountMinor: 1 });
    expect(w.p.fraud.assess({ kind: 'card_chargeback', actorRef: 'cb', amountMinor: 1 }).some((f) => f.check === 'repeated_chargebacks')).toBe(true);
  });

  test('a large refund minutes after capture is flagged (laundering signal)', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = saved(w.p, w.kabo.id);
    const intent = w.p.cards.createIntent(w.kabo.id, { amountMinor: 150000, destAccountId: dest, cardId: card.id, idempotencyKey: 'sr' });
    w.p.cards.capture(intent.id, { idempotencyKey: 'sr-c' });
    w.p.cards.refund(intent.id, { idempotencyKey: 'sr-r' }); // full, immediately
    expect(w.p.fraud.openReviews().some((r) => r.check === 'suspicious_refund')).toBe(true);
  });
});

describe('PCI redaction & card analytics (WS10/WS13)', () => {
  test('intent read models never expose the gateway token', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    const listed = w.p.cards.intentsFor(w.kabo.id)[0];
    expect(listed.gateway_token).toBeUndefined();
    expect(listed.gateway_token_masked).toBeTruthy();
    expect(w.p.cards.myIntent(w.kabo.id, intent.id).gateway_token).toBeUndefined();
    expectErr(() => w.p.cards.myIntent(w.mma.id, intent.id), 'PERMISSION_DENIED');
    expect(w.p.cards.intentDetail(intent.id).gateway_token).toBeUndefined();
  });

  test('gateway capability discovery is public and secret-free', () => {
    const w = world();
    const caps = w.p.cards.gatewayCapabilities();
    expect(caps.gateways).toHaveLength(6);
    expect(caps.brands).toContain('visa');
    expect(JSON.stringify(caps)).not.toContain('secret');
  });

  test('cardAnalytics reports PII-free aggregates and monthly recurring revenue', () => {
    const w = world();
    const dest = merchant(w.p);
    const intent = authorizedIntent(w.p, w.kabo.id, dest);
    w.p.cards.capture(intent.id, { idempotencyKey: 'an-c' });
    const second = authorizedIntent(w.p, w.kabo.id, dest, { card: saved(w.p, w.kabo.id) });
    w.p.cards.refund(intent.id, { amountMinor: 5000, idempotencyKey: 'an-r' });
    w.p.cards.createSubscription(w.kabo.id, { cardId: saved(w.p, w.kabo.id).id, amountMinor: 6000, destAccountId: dest, interval: 'monthly' });

    // Exercise all three routing outcomes in the log: ok, failover, rejected.
    w.p.gateways.get('stripe').faults.failNextAuthorize = 1;
    w.p.gateways.route({ brand: 'visa', currency: 'BWP', op: 'authorize' }, (gw) => {
      const t = gw.tokenize({ hostedFieldRef: 'hf', brand: 'visa', last4: '1' }).token;
      return gw.authorize({ token: t, amountMinor: 100, currency: 'BWP' });
    });
    try {
      w.p.gateways.route({ brand: 'visa', currency: 'BWP', op: 'x' }, () => { throw new Error('hard'); });
    } catch (e) { /* logged as rejected */ }
    w.p.cards.reconcile('2026-07-04T00:00:00.000Z'); // a settlement record

    const a = w.p.analytics.cardAnalytics();
    expect(a.intents).toBeGreaterThanOrEqual(2);
    expect(a.approval_rate_pct).toBeGreaterThan(0);
    expect(a.avg_transaction_value_minor).toBeGreaterThan(0);
    expect(a.recurring.monthly_recurring_revenue_minor).toBe(6000);
    expect(a.gateways.length).toBe(6);
    expect(a.gateways.some((g) => g.failovers > 0)).toBe(true);
    expect(a.settlement).not.toBeNull();
    const serialized = JSON.stringify(a);
    expect(serialized).not.toContain('tok_');
    expect(serialized).not.toContain('4242'); // no card number/last4 in analytics
    expect(second.state).toBe('authorized');

    // The card stack absent → a defensive disabled marker (no throw).
    const { AnalyticsService } = require('../src/analytics/analytics.service');
    expect(AnalyticsService.prototype.cardAnalytics.call({ platform: {} })).toEqual({ enabled: false });
  });

  test('cardAnalytics is included in the platform dashboard (aggregates only)', () => {
    const w = world();
    const dash = w.p.analytics.dashboard();
    expect(dash.cards).toHaveProperty('approval_rate_pct');
    expect(dash.cards).toHaveProperty('gateways');
  });
});
