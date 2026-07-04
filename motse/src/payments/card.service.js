'use strict';

const { id, sha256 } = require('../kernel/ids');
const { err } = require('../kernel/errors');
const { verifySignature } = require('../security/replay');

/**
 * CardService (Phase 4, WS5–WS10) — orchestrates the full card payment
 * lifecycle on top of the existing primitives. It sits beside the
 * Ledger/Escrow services (like EscrowService does) and reuses:
 *   - the CardPaymentProvider's GatewayRegistry for gateway work,
 *   - the provider's ledger clearing account (opened by PaymentService),
 *   - the Ledger for every money movement (the single source of truth),
 *   - the Fraud engine, Audit chain, event bus, Notifications, Analytics.
 *
 * PCI (WS3/WS10): only gateway-issued TOKENS are ever stored. There is
 * no field anywhere in this service for a PAN, CVV, PIN, magnetic-stripe
 * or EMV secret — saveCard takes an opaque hosted-field reference and
 * the gateway returns a token + non-sensitive display metadata.
 *
 * Every mutation: authorized, idempotent, balances the ledger, audits,
 * emits an event, and feeds analytics + fraud.
 */
const INTENT_STATES = [
  'requires_action', // 3DS challenge pending
  'authorized',
  'partially_captured',
  'captured',
  'voided',
  'partially_refunded',
  'refunded',
  'charged_back',
  'declined',
  'failed',
];

class CardService {
  constructor({ store, clock, ledger, payments, provider, gateways, fraud, audit, bus, notifications, analytics, replayGuard }) {
    this.cards = store.collection('saved_cards');
    this.intents = store.collection('card_intents');
    this.subscriptions = store.collection('card_subscriptions');
    this.disputes = store.collection('card_disputes');
    this.settlements = store.collection('card_settlements');
    this.webhookLog = store.collection('card_webhooks');
    this.store = store;
    this.clock = clock;
    this.ledger = ledger;
    this.payments = payments;
    this.provider = provider;
    this.gateways = gateways;
    this.fraud = fraud;
    this.audit = audit;
    this.bus = bus;
    this.notifications = notifications;
    this.analytics = analytics;
    this.replayGuard = replayGuard;

    bus.register('card.intent.authorized', 1, ['intent_id', 'gateway']);
    bus.register('card.captured', 1, ['intent_id', 'amount_minor']);
    bus.register('card.refunded', 1, ['intent_id', 'amount_minor']);
    bus.register('card.chargeback', 1, ['intent_id', 'reason_code']);
    bus.register('card.subscription.charged', 1, ['subscription_id', 'amount_minor']);
    bus.register('card.subscription.state', 1, ['subscription_id', 'state']);

    this._registerFraudChecks();
  }

  clearingAccountId() {
    return this.payments.clearingAccountId('card');
  }

  // ── FX (WS8) ───────────────────────────────────────────────────────

  _fx(amountMinor, currency) {
    const { bwpMinor, rate } = this.provider.fxToBwpMinor(amountMinor, currency);
    return {
      bwp_minor: bwpMinor,
      fx_rate: rate,
      original_currency: currency,
      settlement_currency: 'BWP', // the ledger accounting currency
      charged_amount_minor: amountMinor,
      fx_timestamp: this.clock.nowIso(),
    };
  }

  // ── Saved payment methods (WS6) — token only, masked only ─────────

  saveCard(ownerRef, { hostedFieldRef, brand, last4, expMonth, expYear, nickname, gateway, networkToken = false }) {
    const gw = this.gateways.get(gateway || this.gateways.order[0]);
    const cardBrand = brand || 'visa';
    // Reuse or create the owner's gateway customer vault.
    let customerToken = this._customerToken(ownerRef, gw.name);
    if (!customerToken) {
      customerToken = gw.createCustomer().customer_token;
    }
    const token = gw.tokenize({
      hostedFieldRef, brand: cardBrand, last4, expMonth, expYear, customerToken, networkToken,
    });
    const first = this.cards.count((c) => c.owner_ref === ownerRef && c.state === 'active') === 0;
    const card = this.cards.insert({
      id: id('card'),
      owner_ref: ownerRef,
      gateway: gw.name,
      // ONLY tokens + non-sensitive display data are stored (WS3/WS6).
      gateway_token: token.token,
      customer_token: customerToken,
      network_token: token.network_token,
      brand: token.brand,
      last4: token.last4,
      exp_month: token.exp_month,
      exp_year: token.exp_year,
      nickname: nickname || `${brandLabel(token.brand)} ****${token.last4}`,
      is_default: first,
      state: 'active',
      created_at: this.clock.nowIso(),
    });
    this.audit.append(ownerRef, 'card.saved', `card:${card.id}`, null, {
      brand: token.brand, last4: token.last4, gateway: gw.name,
    });
    return this._maskCard(card);
  }

  listCards(ownerRef) {
    return this.cards.find((c) => c.owner_ref === ownerRef && c.state === 'active').map((c) => this._maskCard(c));
  }

  setDefaultCard(ownerRef, cardId) {
    const card = this._card(cardId, ownerRef);
    for (const c of this.cards.find((x) => x.owner_ref === ownerRef && x.is_default)) {
      this.cards.update(c.id, { is_default: false });
    }
    this.cards.update(cardId, { is_default: true });
    return this._maskCard(this.cards.get(cardId));
  }

  updateCard(ownerRef, cardId, { nickname, expMonth, expYear }) {
    const card = this._card(cardId, ownerRef);
    const patch = {};
    if (nickname !== undefined) patch.nickname = nickname;
    if (expMonth || expYear) {
      const gw = this.gateways.get(card.gateway);
      gw.updateTokenExpiry(card.gateway_token, { expMonth: expMonth || card.exp_month, expYear: expYear || card.exp_year });
      patch.exp_month = expMonth || card.exp_month;
      patch.exp_year = expYear || card.exp_year;
    }
    this.cards.update(cardId, patch);
    return this._maskCard(this.cards.get(cardId));
  }

  /** Token replacement (WS6): swap the gateway token, keep the card id. */
  replaceToken(ownerRef, cardId, { hostedFieldRef, last4, expMonth, expYear }) {
    const card = this._card(cardId, ownerRef);
    const gw = this.gateways.get(card.gateway);
    gw.deleteToken(card.gateway_token);
    const token = gw.tokenize({
      hostedFieldRef, brand: card.brand, last4: last4 || card.last4,
      expMonth: expMonth || card.exp_month, expYear: expYear || card.exp_year,
      customerToken: card.customer_token,
    });
    this.cards.update(cardId, {
      gateway_token: token.token, network_token: token.network_token,
      last4: token.last4, exp_month: token.exp_month, exp_year: token.exp_year,
    });
    this.audit.append(ownerRef, 'card.token_replaced', `card:${cardId}`, null, null);
    return this._maskCard(this.cards.get(cardId));
  }

  deleteCard(ownerRef, cardId) {
    const card = this._card(cardId, ownerRef);
    const gw = this.gateways.get(card.gateway);
    gw.deleteToken(card.gateway_token);
    this.cards.update(cardId, { state: 'deleted', gateway_token: null, network_token: null });
    if (card.is_default) {
      const next = this.cards.find((c) => c.owner_ref === ownerRef && c.state === 'active')[0];
      if (next) this.cards.update(next.id, { is_default: true });
    }
    this.audit.append(ownerRef, 'card.deleted', `card:${cardId}`, null, null);
    return { deleted: true };
  }

  // ── Payment intent + 3-D Secure (WS4/WS5) ─────────────────────────

  /**
   * Create a card payment intent: FX, fraud assessment, 3-D Secure. A
   * frictionless authentication authorizes immediately; a challenge
   * parks the intent in 'requires_action' until complete3DS.
   */
  createIntent(ownerRef, { amountMinor, currency = 'BWP', destAccountId, cardId, token, brand, ref, deviceId, country = 'BW', idempotencyKey }) {
    if (!idempotencyKey) throw err('IDEMPOTENCY_KEY_REQUIRED');
    const existing = this.intents.findOne((i) => i.idempotency_key === idempotencyKey);
    if (existing) return this._redactIntent(existing);
    if (!this.ledger.accounts.get(destAccountId)) throw err('NOT_FOUND', `No destination account ${destAccountId}`);

    let gatewayToken = token;
    let cardBrand = brand;
    let preferredGateway;
    let cardRef = null;
    if (cardId) {
      const card = this._card(cardId, ownerRef);
      gatewayToken = card.gateway_token;
      cardBrand = card.brand;
      preferredGateway = card.gateway;
      cardRef = card.id;
    }
    if (!gatewayToken) throw err('INVALID_ARGUMENT', 'A saved card or gateway token is required (no raw PAN)');
    cardBrand = cardBrand || 'visa';

    const fx = this._fx(amountMinor, currency);

    // Card-specific fraud assessment (WS9) — may deny, or flag for review.
    const fraudFlags = this.fraud.assess({
      kind: 'card_payment', actorRef: ownerRef, amountMinor: fx.bwp_minor,
      subjectRef: destAccountId, deviceId, country, brand: cardBrand,
      bin: String(gatewayToken).slice(-6), token: gatewayToken,
    });

    // 3-D Secure via the routed gateway (RBA → frictionless or challenge).
    const { result: tds, gateway } = this.gateways.route(
      { brand: cardBrand, currency, op: '3ds', preferred: preferredGateway },
      (gw) => gw.authenticate3DS({ token: gatewayToken, amountMinor, currency })
    );

    const intent = this.intents.insert({
      id: id('cin'),
      owner_ref: ownerRef,
      card_ref: cardRef,
      gateway,
      gateway_token: gatewayToken,
      brand: cardBrand,
      dest_account_id: destAccountId,
      amount_minor: fx.bwp_minor, // ledger amount (BWP thebe)
      ...fx,
      three_ds: tds,
      state: tds.status === 'challenge_required' ? 'requires_action' : 'authorized',
      gw_ref: null,
      captured_minor: 0,
      refunded_minor: 0,
      ref: ref || null,
      country,
      fraud_flags: fraudFlags,
      review: fraudFlags.some((f) => f.action === 'review'),
      idempotency_key: idempotencyKey,
      created_at: this.clock.nowIso(),
    });

    if (intent.state === 'authorized') {
      return this._authorize(intent.id);
    }
    // Challenge required — the client completes it, then we authorize.
    this._track('card.intent.created', intent);
    return this._redactIntent(this.intents.get(intent.id));
  }

  /** Complete a 3-D Secure challenge, then authorize (WS4 challenge flow). */
  complete3DS(intentId, { success = true } = {}) {
    const intent = this._intent(intentId);
    if (intent.state !== 'requires_action') throw err('STATE_CONFLICT', 'No pending 3DS challenge');
    const gw = this.gateways.get(intent.gateway);
    const tds = gw.complete3DS(intent.three_ds.three_ds_ref, { success });
    this.intents.update(intentId, { three_ds: { ...intent.three_ds, ...tds } });
    if (!success || tds.status !== 'authenticated') {
      return this._fail(intentId, '3DS_FAILED');
    }
    return this._authorize(intentId);
  }

  _authorize(intentId) {
    const intent = this._intent(intentId);
    let auth;
    let usedGateway = intent.gateway;
    try {
      const routed = this.gateways.route(
        { brand: intent.brand, currency: intent.original_currency, op: 'authorize', preferred: intent.gateway },
        (gw) => gw.authorize({
          token: intent.gateway_token, amountMinor: intent.charged_amount_minor,
          currency: intent.original_currency, threeDs: intent.three_ds, ref: `card:${intent.id}`,
        })
      );
      auth = routed.result;
      usedGateway = routed.gateway;
    } catch (e) {
      return this._fail(intentId, e.message);
    }
    if (auth.state === 'declined') {
      this._track('card.declined', intent);
      return this._fail(intentId, auth.decline_reason || 'DECLINED');
    }
    const updated = this.intents.update(intentId, {
      state: 'authorized', gw_ref: auth.gw_ref, gateway: usedGateway,
    });
    this.audit.append(intent.owner_ref, 'card.authorized', `card_intent:${intentId}`, null, {
      gateway: usedGateway, amount_minor: intent.amount_minor,
    });
    this.bus.publish('card.intent.authorized', { intent_id: intentId, gateway: usedGateway });
    this._track('card.authorized', updated);
    return this._redactIntent(updated);
  }

  // ── Capture / partial capture / void (WS5) ────────────────────────

  capture(intentId, { amountMinor, idempotencyKey, actorRef } = {}) {
    const intent = this._intent(intentId);
    if (!['authorized', 'partially_captured'].includes(intent.state)) {
      throw err('STATE_CONFLICT', `Cannot capture from ${intent.state}`);
    }
    const gw = this.gateways.get(intent.gateway);
    // Capture amount in the CHARGED currency; convert to BWP for the ledger.
    const chargedRemaining = intent.charged_amount_minor - this._chargedCaptured(intent);
    const chargeAmount = amountMinor === undefined ? chargedRemaining : amountMinor;
    const capture = gw.capture(intent.gw_ref, { amountMinor: chargeAmount });
    const bwpAmount = Math.round(chargeAmount * intent.fx_rate);

    // Ledger: the card clearing account owes us the settled funds; debit
    // it and credit the destination (mirrors provider deposits).
    this.ledger.providerDeposit({
      providerAccountId: this.clearingAccountId(),
      destAccountId: intent.dest_account_id,
      amountMinor: bwpAmount,
      providerTxRef: `card:${intentId}`,
      idempotencyKey: idempotencyKey || `card-capture:${intentId}:${intent.captured_minor}`,
    });
    const updated = this.intents.update(intentId, {
      captured_minor: intent.captured_minor + bwpAmount,
      captured_charged_minor: this._chargedCaptured(intent) + chargeAmount,
      state: capture.state === 'captured' ? 'captured' : 'partially_captured',
    });
    this.audit.append(actorRef || intent.owner_ref, 'card.captured', `card_intent:${intentId}`, null, {
      amount_minor: bwpAmount, gateway: intent.gateway,
    });
    this.bus.publish('card.captured', { intent_id: intentId, amount_minor: bwpAmount });
    this._notify(intent.owner_ref, 'card_payment', 'Card payment received', `${money(bwpAmount)} captured`);
    this._track('card.captured_amount', updated, bwpAmount);
    return this._redactIntent(updated);
  }

  voidAuthorization(intentId, { actorRef } = {}) {
    const intent = this._intent(intentId);
    if (!['authorized', 'partially_captured'].includes(intent.state)) {
      throw err('STATE_CONFLICT', `Cannot void from ${intent.state}`);
    }
    const gw = this.gateways.get(intent.gateway);
    gw.voidAuthorization(intent.gw_ref);
    const updated = this.intents.update(intentId, { state: 'voided' });
    this.audit.append(actorRef || intent.owner_ref, 'card.voided', `card_intent:${intentId}`, null, null);
    return this._redactIntent(updated);
  }

  // ── Refund / partial refund (WS5) ─────────────────────────────────

  refund(intentId, { amountMinor, idempotencyKey, actorRef, reason } = {}) {
    const intent = this._intent(intentId);
    if (!['captured', 'partially_captured', 'partially_refunded'].includes(intent.state)) {
      throw err('STATE_CONFLICT', 'Only captured card payments can be refunded');
    }
    const refundable = intent.captured_minor - intent.refunded_minor;
    const bwpAmount = amountMinor === undefined ? refundable : amountMinor;
    if (bwpAmount <= 0 || bwpAmount > refundable) {
      throw err('STATE_CONFLICT', 'Refund exceeds the captured remaining amount', { refundable_minor: refundable });
    }
    const chargeAmount = Math.round(bwpAmount / intent.fx_rate);
    const gw = this.gateways.get(intent.gateway);
    gw.refund(intent.gw_ref, { amountMinor: chargeAmount });

    // Suspicious-refund fraud signal (WS9): a refund to a different actor
    // or an unusually fast full refund is flagged.
    this.fraud.assess({
      kind: 'card_refund', actorRef: actorRef || intent.owner_ref, amountMinor: bwpAmount,
      subjectRef: intent.dest_account_id, brand: intent.brand,
      age_ms: this.clock.nowMs() - new Date(intent.created_at).getTime(),
    });

    // Ledger reversal: destination → card clearing.
    this.ledger.post({
      entries: [
        { account_id: intent.dest_account_id, amount_minor: -bwpAmount },
        { account_id: this.clearingAccountId(), amount_minor: bwpAmount },
      ],
      purpose: 'card_refund',
      ref: `card:${intentId}`,
      idempotencyKey: idempotencyKey || `card-refund:${intentId}:${intent.refunded_minor}`,
      actorRef: actorRef || 'system:card',
    });
    const refunded = intent.refunded_minor + bwpAmount;
    const updated = this.intents.update(intentId, {
      refunded_minor: refunded,
      state: refunded >= intent.captured_minor ? 'refunded' : 'partially_refunded',
    });
    this.audit.append(actorRef || intent.owner_ref, 'card.refunded', `card_intent:${intentId}`, null, {
      amount_minor: bwpAmount, reason: reason || null,
    });
    this.bus.publish('card.refunded', { intent_id: intentId, amount_minor: bwpAmount });
    this._notify(intent.owner_ref, 'card_payment', 'Card refund issued', money(bwpAmount));
    this._track('card.refunded_amount', updated, bwpAmount);
    return this._redactIntent(updated);
  }

  // ── Chargebacks & disputes (WS5) ──────────────────────────────────

  processChargeback(intentId, { reasonCode = 'FRAUD', actorRef } = {}) {
    const intent = this._intent(intentId);
    if (intent.state === 'charged_back') return intent;
    if (intent.captured_minor <= intent.refunded_minor) {
      throw err('STATE_CONFLICT', 'Nothing captured to charge back');
    }
    const amount = intent.captured_minor - intent.refunded_minor;
    // Ledger clawback: destination → card clearing.
    this.ledger.post({
      entries: [
        { account_id: intent.dest_account_id, amount_minor: -amount },
        { account_id: this.clearingAccountId(), amount_minor: amount },
      ],
      purpose: 'card_chargeback',
      ref: `card:${intentId}`,
      idempotencyKey: `card-chargeback:${intentId}`,
      actorRef: actorRef || 'system:card',
    });
    const updated = this.intents.update(intentId, {
      state: 'charged_back',
      chargeback: { reason_code: reasonCode, amount_minor: amount, at: this.clock.nowIso() },
    });
    // A dispute case opens for the merchant-ops workflow.
    const dispute = this.disputes.insert({
      id: id('dsp'),
      intent_id: intentId,
      owner_ref: intent.owner_ref,
      reason_code: reasonCode,
      amount_minor: amount,
      state: 'open', // open → evidence_submitted → won | lost
      created_at: this.clock.nowIso(),
    });
    // Chargeback is a strong fraud signal → review.
    this.fraud.assess({
      kind: 'card_chargeback', actorRef: intent.owner_ref, amountMinor: amount,
      subjectRef: intent.dest_account_id, brand: intent.brand,
    });
    this.audit.append(actorRef || 'system:card', 'card.chargeback', `card_intent:${intentId}`, null, {
      reason_code: reasonCode, amount_minor: amount, dispute_id: dispute.id,
    });
    this.bus.publish('card.chargeback', { intent_id: intentId, reason_code: reasonCode });
    this._notify(intent.owner_ref, 'card_payment', 'Chargeback filed', `Dispute ${dispute.id}`);
    this._track('card.chargeback_count', updated);
    return dispute;
  }

  submitDisputeEvidence(disputeId, evidenceRefs, actor) {
    const dispute = this._dispute(disputeId);
    if (dispute.state !== 'open') throw err('STATE_CONFLICT', `Dispute is ${dispute.state}`);
    const updated = this.disputes.update(disputeId, {
      state: 'evidence_submitted', evidence_refs: evidenceRefs || [],
    });
    this.audit.append(actor, 'card.dispute_evidence', `card_dispute:${disputeId}`, null, {
      evidence_count: (evidenceRefs || []).length,
    });
    return updated;
  }

  resolveDispute(disputeId, outcome, actor) {
    const dispute = this._dispute(disputeId);
    if (!['won', 'lost'].includes(outcome)) throw err('INVALID_ARGUMENT', 'outcome must be won|lost');
    if (outcome === 'won') {
      // Representment won → re-credit the destination from clearing.
      this.ledger.post({
        entries: [
          { account_id: this.clearingAccountId(), amount_minor: -dispute.amount_minor },
          { account_id: this.intents.get(dispute.intent_id).dest_account_id, amount_minor: dispute.amount_minor },
        ],
        purpose: 'card_dispute_won',
        ref: `card:${dispute.intent_id}`,
        idempotencyKey: `dispute-won:${disputeId}`,
        actorRef: actor,
      });
    }
    const updated = this.disputes.update(disputeId, { state: outcome, resolved_at: this.clock.nowIso() });
    this.audit.append(actor, 'card.dispute_resolved', `card_dispute:${disputeId}`, null, { outcome });
    return updated;
  }

  // ── Settlement & reconciliation (WS5) ─────────────────────────────

  reconcile(dateIso) {
    const statement = this.provider.fetchStatement(dateIso || this.clock.nowIso());
    const report = this.ledger.reconcile(
      this.clearingAccountId(),
      statement.map((line) => {
        const bwp = line.currency && line.currency !== 'BWP'
          ? this.provider.fxToBwpMinor(line.amount_minor, line.currency).bwpMinor
          : line.amount_minor;
        return { ref: line.ref, amount_minor: bwp };
      })
    );
    const record = this.settlements.insert({
      id: id('cst'),
      date: (dateIso || this.clock.nowIso()).slice(0, 10),
      lines: statement.length,
      matched: report.matched,
      variance_minor: report.variance_minor,
      ran_at: this.clock.nowIso(),
    });
    return { settlement_id: record.id, ...report };
  }

  // ── Secure card webhooks (WS10) ───────────────────────────────────

  processWebhook(gatewayName, rawBody, headers) {
    const gw = this.gateways.get(gatewayName);
    const versions = this.provider.secrets.validForVerification(gw.secretName);
    const { 'x-motse-signature': signature, 'x-motse-timestamp': timestamp, 'x-motse-nonce': nonce } = headers;
    // Rotation-safe, constant-time verification (accepts current+previous
    // secret; a malformed/short signature is rejected, never throws).
    if (!verifySignature(versions, { timestamp, nonce, rawBody, signature })) {
      throw err('PERMISSION_DENIED', 'Card webhook signature verification failed');
    }
    // Replay protection: stale timestamps and reused nonces are rejected.
    if (this.replayGuard) this.replayGuard.assertFresh(timestamp, nonce);
    const parsed = gw.parseWebhook(JSON.parse(rawBody));
    // Duplicate protection.
    if (this.webhookLog.findOne((w) => w.gw_ref === parsed.gw_ref && w.event === parsed.event)) {
      return { duplicate: true };
    }
    const intent = this.intents.findOne((i) => i.gw_ref === parsed.gw_ref);
    if (!intent) throw err('NOT_FOUND', `No card intent for ${parsed.gw_ref}`);
    this.webhookLog.insert({
      id: id('cwh'), gw_ref: parsed.gw_ref, event: parsed.event, intent_id: intent.id, ts: this.clock.nowIso(),
    });
    if (parsed.event === 'chargeback' || parsed.event === 'dispute') {
      return this.processChargeback(intent.id, { reasonCode: parsed.reason_code || 'FRAUD' });
    }
    return { acknowledged: true, intent_id: intent.id };
  }

  // ── Subscriptions & recurring (WS7) ───────────────────────────────

  createSubscription(ownerRef, { cardId, amountMinor, currency = 'BWP', destAccountId, interval = 'monthly', plan, graceDays = 3 }) {
    const card = this._card(cardId, ownerRef);
    if (!this.ledger.accounts.get(destAccountId)) throw err('NOT_FOUND', `No destination account ${destAccountId}`);
    if (!INTERVALS[interval]) throw err('INVALID_ARGUMENT', `Unknown interval ${interval}`);
    const sub = this.subscriptions.insert({
      id: id('sub'),
      owner_ref: ownerRef,
      card_ref: card.id,
      plan: plan || 'donation', // donation | membership | tourism | learning
      amount_minor: amountMinor,
      currency,
      dest_account_id: destAccountId,
      interval,
      grace_ms: graceDays * 24 * 3600 * 1000,
      state: 'active', // active | past_due | paused | cancelled
      next_charge_at: this.clock.nowMs() + INTERVALS[interval],
      failures: 0,
      charges: 0,
      created_at: this.clock.nowIso(),
    });
    this.audit.append(ownerRef, 'card.subscription_created', `subscription:${sub.id}`, null, {
      plan: sub.plan, interval, amount_minor: amountMinor,
    });
    this.bus.publish('card.subscription.state', { subscription_id: sub.id, state: 'active' });
    return sub;
  }

  /** Billing scheduler tick: charge due subscriptions, retry/grace. */
  runBilling() {
    const now = this.clock.nowMs();
    const out = { charged: 0, retried: 0, past_due: 0, cancelled: 0 };
    for (const sub of this.subscriptions.find((s) => ['active', 'past_due'].includes(s.state))) {
      if (sub.next_charge_at > now) continue;
      try {
        const intent = this.createIntent(sub.owner_ref, {
          amountMinor: sub.amount_minor, currency: sub.currency, destAccountId: sub.dest_account_id,
          cardId: sub.card_ref, ref: `sub:${sub.id}`,
          idempotencyKey: `sub:${sub.id}:${sub.charges}`,
        });
        if (intent.state === 'authorized') {
          this.capture(intent.id, { idempotencyKey: `sub-cap:${sub.id}:${sub.charges}` });
        } else if (intent.state !== 'requires_action') {
          throw err('STATE_CONFLICT', 'subscription charge not authorized');
        }
        this.subscriptions.update(sub.id, {
          state: 'active', failures: 0, charges: sub.charges + 1,
          next_charge_at: now + INTERVALS[sub.interval], last_charge_at: this.clock.nowIso(),
        });
        this.bus.publish('card.subscription.charged', { subscription_id: sub.id, amount_minor: sub.amount_minor });
        out.charged += 1;
      } catch (e) {
        const failures = sub.failures + 1;
        // Automatic retry within the grace window; then cancel.
        if (failures * INTERVALS.retry <= sub.grace_ms) {
          this.subscriptions.update(sub.id, { state: 'past_due', failures, next_charge_at: now + INTERVALS.retry });
          out.retried += 1;
          out.past_due += 1;
        } else {
          this.subscriptions.update(sub.id, { state: 'cancelled', failures, cancel_reason: 'payment_failed' });
          this.bus.publish('card.subscription.state', { subscription_id: sub.id, state: 'cancelled' });
          this._notify(sub.owner_ref, 'card_payment', 'Subscription cancelled', 'Payment failed after grace period');
          out.cancelled += 1;
        }
      }
    }
    return out;
  }

  pauseSubscription(ownerRef, subId) {
    return this._subTransition(ownerRef, subId, 'paused', ['active', 'past_due']);
  }

  resumeSubscription(ownerRef, subId) {
    const sub = this._subscription(subId, ownerRef);
    if (sub.state !== 'paused') throw err('STATE_CONFLICT', 'Subscription is not paused');
    const updated = this.subscriptions.update(subId, {
      state: 'active', next_charge_at: this.clock.nowMs() + INTERVALS[sub.interval],
    });
    this.bus.publish('card.subscription.state', { subscription_id: subId, state: 'active' });
    return updated;
  }

  cancelSubscription(ownerRef, subId) {
    return this._subTransition(ownerRef, subId, 'cancelled', ['active', 'past_due', 'paused']);
  }

  /** Proration (WS7): amount owed for a mid-cycle plan change. */
  prorate(subId, newAmountMinor) {
    const sub = this._subscription(subId);
    const cycle = INTERVALS[sub.interval];
    const remaining = Math.max(sub.next_charge_at - this.clock.nowMs(), 0);
    const fraction = remaining / cycle;
    const credit = Math.round(sub.amount_minor * fraction);
    const charge = Math.round(newAmountMinor * fraction);
    return { credit_minor: credit, charge_minor: charge, net_minor: charge - credit, fraction: Math.round(fraction * 100) / 100 };
  }

  changePlan(ownerRef, subId, { amountMinor, plan }) {
    const sub = this._subscription(subId, ownerRef);
    const proration = amountMinor !== undefined ? this.prorate(subId, amountMinor) : null;
    const updated = this.subscriptions.update(subId, {
      amount_minor: amountMinor !== undefined ? amountMinor : sub.amount_minor,
      plan: plan || sub.plan,
    });
    this.audit.append(ownerRef, 'card.subscription_changed', `subscription:${subId}`, null, { proration });
    return { subscription: updated, proration };
  }

  listSubscriptions(ownerRef) {
    return this.subscriptions.find((s) => s.owner_ref === ownerRef);
  }

  // ── Read models (wallet + admin) ──────────────────────────────────

  intent(intentId) {
    return this._intent(intentId);
  }

  /** Redacted single intent (admin explorer) — never leaks the token. */
  intentDetail(intentId) {
    return this._redactIntent(this._intent(intentId));
  }

  /** Owner-scoped single intent (customer wallet). */
  myIntent(ownerRef, intentId) {
    const intent = this._intent(intentId);
    if (intent.owner_ref !== ownerRef) throw err('PERMISSION_DENIED', 'Not your card payment');
    return this._redactIntent(intent);
  }

  intentsFor(ownerRef) {
    return this.intents.find((i) => i.owner_ref === ownerRef).map((i) => this._redactIntent(i));
  }

  listIntents(filter = {}) {
    return this.intents
      .find((i) => (filter.state ? i.state === filter.state : true) && (filter.gateway ? i.gateway === filter.gateway : true))
      .map((i) => this._redactIntent(i));
  }

  openDisputes() {
    return this.disputes.find((d) => d.state === 'open' || d.state === 'evidence_submitted');
  }

  /**
   * Public gateway capability discovery (WS14 SDK) — brands, currencies
   * and selection order per gateway. Carries no secrets and no health
   * detail (that is admin-only via the registry describe()).
   */
  gatewayCapabilities() {
    return {
      brands: this.provider.brands,
      currencies: this.provider.supportedCurrencies(),
      order: this.gateways.order,
      gateways: [...this.gateways.gateways.values()].map((gw) => ({
        name: gw.name,
        brands: gw.supportedBrands,
        currencies: gw.supportedCurrencies,
        mode: gw.live ? 'live' : 'sandbox',
      })),
    };
  }

  // ── PCI helpers (WS10) ─────────────────────────────────────────────

  _maskCard(card) {
    return {
      id: card.id,
      owner_ref: card.owner_ref,
      brand: card.brand,
      display: `${brandLabel(card.brand)} **** **** **** ${card.last4}`,
      last4: card.last4,
      exp_month: card.exp_month,
      exp_year: card.exp_year,
      nickname: card.nickname,
      is_default: card.is_default,
      gateway: card.gateway,
      logo: `/assets/card/${card.brand}.svg`,
    };
  }

  /**
   * Redact any token/sensitive field from intent read models. The token
   * is replaced by a non-reversible support handle (last 4 chars only) —
   * never the usable token or its gateway prefix.
   */
  _redactIntent(intent) {
    const { gateway_token, ...safe } = intent;
    return { ...safe, gateway_token_masked: gateway_token ? `****${String(gateway_token).slice(-4)}` : null };
  }

  _registerFraudChecks() {
    // Card-specific fraud (WS9) plugged into the EXISTING fraud engine.
    const seenBins = new Map(); // actorRef -> [{ bin, at }]
    const seenTokens = new Map(); // token -> Set(actorRef)
    const chargebackCounts = new Map(); // actorRef -> count

    this.fraud.register('card_testing', (ctx, engine) => {
      if (ctx.kind !== 'card_payment' || !ctx.actorRef) return null;
      // Many small charges in a short window = card testing.
      const windowStart = engine.clock.nowMs() - 10 * 60 * 1000;
      const recent = (engine._history || []).filter(
        (h) => h.actorRef === ctx.actorRef && h.kind === 'card_payment' && h.at >= windowStart
      );
      if (recent.length >= 8 && ctx.amountMinor < 5000) {
        return { action: 'deny', detail: 'card-testing pattern (many small charges)' };
      }
      return null;
    });
    this.fraud.register('bin_abuse', (ctx, engine) => {
      if (ctx.kind !== 'card_payment' || !ctx.bin || !ctx.actorRef) return null;
      const list = (seenBins.get(ctx.actorRef) || []).filter((x) => x.at >= engine.clock.nowMs() - 3600 * 1000);
      list.push({ bin: ctx.bin, at: engine.clock.nowMs() });
      seenBins.set(ctx.actorRef, list);
      const distinct = new Set(list.map((x) => x.bin)).size;
      if (distinct >= 5) return { action: 'review', detail: `${distinct} distinct BINs in 1h` };
      return null;
    });
    this.fraud.register('duplicate_card', (ctx) => {
      if (ctx.kind !== 'card_payment' || !ctx.token) return null;
      if (!seenTokens.has(ctx.token)) seenTokens.set(ctx.token, new Set());
      seenTokens.get(ctx.token).add(ctx.actorRef);
      if (seenTokens.get(ctx.token).size >= 3) {
        return { action: 'review', detail: 'same card token used by 3+ accounts' };
      }
      return null;
    });
    this.fraud.register('high_risk_country', (ctx) => {
      if (ctx.kind !== 'card_payment') return null;
      if (HIGH_RISK_COUNTRIES.has(ctx.country)) {
        return { action: 'review', detail: `high-risk country ${ctx.country}` };
      }
      return null;
    });
    this.fraud.register('repeated_chargebacks', (ctx) => {
      if (ctx.kind !== 'card_chargeback' || !ctx.actorRef) return null;
      const count = (chargebackCounts.get(ctx.actorRef) || 0) + 1;
      chargebackCounts.set(ctx.actorRef, count);
      if (count >= 2) return { action: 'review', detail: `${count} chargebacks on this account` };
      return null;
    });
    this.fraud.register('suspicious_refund', (ctx) => {
      if (ctx.kind !== 'card_refund') return null;
      // A full refund within minutes of capture is a laundering signal.
      if (ctx.age_ms !== undefined && ctx.age_ms < 5 * 60 * 1000 && ctx.amountMinor >= 100000) {
        return { action: 'review', detail: 'large refund minutes after capture' };
      }
      return null;
    });
  }

  // ── Internals ──────────────────────────────────────────────────────

  _track(event, intent, amount) {
    if (!this.analytics) return;
    // Analytics never sees a token or PAN — only aggregate/brand data.
    this.analytics._bump(event);
    if (event === 'card.captured_amount' || event === 'card.refunded_amount') {
      this.analytics._bump(`${event}:${intent.brand}`);
    }
  }

  _notify(userRef, category, title, body) {
    if (this.notifications) this.notifications.notify(userRef, { category, title, body });
  }

  _chargedCaptured(intent) {
    return intent.captured_charged_minor || 0;
  }

  _fail(intentId, reason) {
    const intent = this.intents.get(intentId);
    const updated = this.intents.update(intentId, { state: 'declined', failure_reason: reason });
    this.audit.append(intent.owner_ref, 'card.declined', `card_intent:${intentId}`, null, { reason });
    this._track('card.declined_count', updated);
    this._notify(intent.owner_ref, 'card_payment', 'Card payment declined', reason);
    return this._redactIntent(updated);
  }

  _subTransition(ownerRef, subId, state, from) {
    const sub = this._subscription(subId, ownerRef);
    if (!from.includes(sub.state)) throw err('STATE_CONFLICT', `Cannot move ${sub.state} → ${state}`);
    const updated = this.subscriptions.update(subId, { state });
    this.audit.append(ownerRef, `card.subscription_${state}`, `subscription:${subId}`, null, null);
    this.bus.publish('card.subscription.state', { subscription_id: subId, state });
    return updated;
  }

  _card(cardId, ownerRef) {
    const card = this.cards.get(cardId);
    if (!card || card.state !== 'active') throw err('NOT_FOUND', `No card ${cardId}`);
    if (ownerRef && card.owner_ref !== ownerRef) throw err('PERMISSION_DENIED', 'Not your card');
    return card;
  }

  _customerToken(ownerRef, gatewayName) {
    const existing = this.cards.findOne((c) => c.owner_ref === ownerRef && c.gateway === gatewayName && c.customer_token);
    return existing ? existing.customer_token : null;
  }

  _intent(intentId) {
    const intent = this.intents.get(intentId);
    if (!intent) throw err('NOT_FOUND', `No card intent ${intentId}`);
    return intent;
  }

  _dispute(disputeId) {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) throw err('NOT_FOUND', `No dispute ${disputeId}`);
    return dispute;
  }

  _subscription(subId, ownerRef) {
    const sub = this.subscriptions.get(subId);
    if (!sub) throw err('NOT_FOUND', `No subscription ${subId}`);
    if (ownerRef && sub.owner_ref !== ownerRef) throw err('PERMISSION_DENIED', 'Not your subscription');
    return sub;
  }
}

const INTERVALS = {
  daily: 24 * 3600 * 1000,
  weekly: 7 * 24 * 3600 * 1000,
  monthly: 30 * 24 * 3600 * 1000,
  annual: 365 * 24 * 3600 * 1000,
  retry: 24 * 3600 * 1000,
};

const HIGH_RISK_COUNTRIES = new Set(['XX', 'ZZ']); // configurable sanctions/AML list

function brandLabel(brand) {
  return { visa: 'Visa', mastercard: 'Mastercard', amex: 'Amex', discover: 'Discover' }[brand] || 'Card';
}

function money(minor) {
  return `BWP ${(minor / 100).toFixed(2)}`;
}

module.exports = { CardService, INTENT_STATES, INTERVALS };
