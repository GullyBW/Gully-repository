'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');
const { verifySignature } = require('../security/replay');
const { RetryQueue } = require('./retry.queue');

/**
 * PaymentService — the ONLY integration point between Motse and money
 * operators (P3: no module talks to a provider directly; §9.1:
 * providers are adapters that translate webhooks into ledger postings).
 *
 * Flows:
 *  C2B  collect(): intent → provider.initiateCollection → operator
 *       webhook(success) → ledger.providerDeposit → intent completed.
 *  B2C  payout(): fraud/device checks upstream → ledger.requestPayout
 *       (funds move to the provider clearing account immediately) →
 *       provider.initiatePayout → webhook receipt → ledger.settlePayout;
 *       failure webhook → ledger.failPayout (automatic reversal).
 *  Refund: capability-gated; reverses the original deposit posting on
 *       the refund-success webhook.
 *
 * Safety: HMAC signature over the raw body (rotating secrets), replay
 * window + nonce, duplicate webhook detection per provider_ref+outcome,
 * transient dispatch failures retried with backoff, every state change
 * evented and audited. The ledger remains the single source of truth —
 * this service never computes a balance itself.
 */
class PaymentService {
  constructor({ store, clock, bus, ledger, secrets, replayGuard, fraud, audit }) {
    this.intents = store.collection('payment_intents');
    this.webhookLog = store.collection('payment_webhooks');
    this.clock = clock;
    this.bus = bus;
    this.ledger = ledger;
    this.secrets = secrets;
    this.replayGuard = replayGuard;
    this.fraud = fraud;
    this.audit = audit;
    this.providers = new Map();
    this.clearingAccounts = new Map(); // provider name -> ledger account id
    this.retryQueue = new RetryQueue(clock);

    bus.register('payments.intent.completed', 1, ['intent_id', 'provider', 'type']);
    bus.register('payments.intent.failed', 1, ['intent_id', 'provider', 'reason']);
    bus.register('payments.webhook.rejected', 1, ['provider', 'reason']);
  }

  registerProvider(provider) {
    this.providers.set(provider.name, provider);
    const account = this.ledger.openAccount(`provider:${provider.name}`, 'provider_clearing');
    this.clearingAccounts.set(provider.name, account.id);
    return account;
  }

  provider(name) {
    const provider = this.providers.get(name);
    if (!provider) throw err('NOT_FOUND', `No payment provider ${name}`);
    return provider;
  }

  clearingAccountId(name) {
    const accountId = this.clearingAccounts.get(name);
    if (!accountId) throw err('NOT_FOUND', `No clearing account for ${name}`);
    return accountId;
  }

  // ── C2B: collections ───────────────────────────────────────────────

  collect({ provider: providerName, msisdn, amountMinor, destAccountId, purposeRef, actorRef, idempotencyKey, currency = 'BWP' }) {
    if (!idempotencyKey) throw err('IDEMPOTENCY_KEY_REQUIRED');
    const existing = this.intents.findOne((i) => i.idempotency_key === idempotencyKey);
    if (existing) return existing;
    const provider = this.provider(providerName);
    if (!this.ledger.accounts.get(destAccountId)) {
      throw err('NOT_FOUND', `No destination account ${destAccountId}`);
    }
    // Capability discovery (WS2): only ask a multi-currency provider for
    // a non-BWP collection. The ledger stays in thebe; the FX rate is
    // captured on the intent so the conversion is auditable.
    if (currency !== 'BWP' && !provider.supportsMultiCurrency()) {
      throw err('INVALID_ARGUMENT', `${providerName} does not support ${currency}`, {
        supported_currencies: provider.supportedCurrencies(),
      });
    }
    const { bwpMinor, rate } = provider.fxToBwpMinor(amountMinor, currency);
    this.fraud.assess({ kind: 'collection', actorRef, amountMinor: bwpMinor, subjectRef: destAccountId });
    const intent = this.intents.insert({
      id: id('pin'),
      type: 'collection',
      provider: providerName,
      msisdn_ref: msisdn, // production stores a hash; ref kept for operator dialogue
      amount_minor: bwpMinor, // ledger amount (thebe)
      charged_amount_minor: amountMinor, // what the buyer was charged
      currency,
      fx_rate: rate,
      dest_account_id: destAccountId,
      purpose_ref: purposeRef || null,
      actor_ref: actorRef || null,
      idempotency_key: idempotencyKey,
      state: 'initiated',
      provider_ref: null,
      created_at: this.clock.nowIso(),
    });
    this._dispatch(intent.id, () => {
      const result = provider.initiateCollection({
        msisdn,
        amountMinor,
        currency,
        ref: `intent:${intent.id}`,
      });
      this.intents.update(intent.id, { state: 'pending_provider', provider_ref: result.provider_ref });
    });
    return this.intents.get(intent.id);
  }

  /**
   * Provider discovery (WS2): pick a provider for a requirement set
   * without any provider-specific branching in callers.
   * requirements: { currency, country, needs: ['partial_refunds', …] }
   */
  selectProvider({ currency = 'BWP', country = 'BW', needs = [] } = {}) {
    for (const provider of this.providers.values()) {
      if (!provider.supportedCurrencies().includes(currency)) continue;
      if (country && !provider.supportedCountries().includes(country)) continue;
      const capabilities = provider.describeCapabilities();
      if (needs.every((need) => capabilities[need])) return provider.name;
    }
    return null;
  }

  /** The full capability matrix for admin/config surfaces. */
  capabilityMatrix() {
    return [...this.providers.values()].map((p) => p.describeCapabilities());
  }

  // ── B2C: payouts ───────────────────────────────────────────────────

  payout({ provider: providerName, sourceAccountId, msisdn, amountMinor, ref, actorRef, idempotencyKey, deviceAgeMs }) {
    if (!idempotencyKey) throw err('IDEMPOTENCY_KEY_REQUIRED');
    const existing = this.intents.findOne((i) => i.idempotency_key === idempotencyKey);
    if (existing) return existing;
    const provider = this.provider(providerName);
    this.fraud.assess({ kind: 'payout', actorRef, amountMinor, subjectRef: sourceAccountId, deviceAgeMs, msisdn });
    // Money leaves the member account NOW, into clearing — the ledger
    // is the source of truth for "in flight" (§9.1).
    const ledgerPayout = this.ledger.requestPayout({
      accountId: sourceAccountId,
      providerAccountId: this.clearingAccountId(providerName),
      amountMinor,
      msisdnRef: msisdn,
      ref: ref || `payout-intent:${idempotencyKey}`,
      idempotencyKey,
    });
    const intent = this.intents.insert({
      id: id('pin'),
      type: 'payout',
      provider: providerName,
      msisdn_ref: msisdn,
      amount_minor: amountMinor,
      source_account_id: sourceAccountId,
      ledger_payout_id: ledgerPayout.id,
      actor_ref: actorRef || null,
      idempotency_key: idempotencyKey,
      state: 'initiated',
      provider_ref: null,
      created_at: this.clock.nowIso(),
    });
    this._dispatch(intent.id, () => {
      const result = provider.initiatePayout({ msisdn, amountMinor, ref: `intent:${intent.id}` });
      this.intents.update(intent.id, { state: 'pending_provider', provider_ref: result.provider_ref });
    });
    this.audit.append(actorRef || 'system:payments', 'payments.payout_initiated',
      `intent:${intent.id}`, null, { provider: providerName, amount_minor: amountMinor });
    return this.intents.get(intent.id);
  }

  // ── Refunds ────────────────────────────────────────────────────────

  /**
   * @param {number} [amountMinor] BWP thebe to refund; omit for full.
   * Capability discovery decides whether a partial is even allowed —
   * no provider-specific branching here (WS2).
   */
  refund({ intentId, actorRef, idempotencyKey, amountMinor }) {
    if (!idempotencyKey) throw err('IDEMPOTENCY_KEY_REQUIRED');
    const existing = this.intents.findOne((i) => i.idempotency_key === idempotencyKey);
    if (existing) return existing;
    const original = this._mustGet(intentId);
    if (original.type !== 'collection' || !['completed', 'partially_refunded'].includes(original.state)) {
      throw err('STATE_CONFLICT', 'Only completed collections can be refunded');
    }
    const provider = this.provider(original.provider);
    if (!provider.supportsRefunds()) {
      throw err('INVALID_ARGUMENT', `${original.provider} does not support operator refunds`, {
        alternative: 'use a B2C payout instead',
      });
    }
    // Sum prior refunds against this collection to cap cumulative refunds.
    const priorRefunds = this.intents
      .find((i) => i.type === 'refund' && i.original_intent_id === intentId && i.state !== 'failed')
      .reduce((s, i) => s + i.amount_minor, 0);
    const remaining = original.amount_minor - priorRefunds;
    const refundBwp = amountMinor === undefined ? remaining : amountMinor;
    if (refundBwp <= 0 || refundBwp > remaining) {
      throw err('STATE_CONFLICT', 'Refund exceeds the remaining refundable amount', {
        refundable_minor: remaining,
      });
    }
    if (refundBwp < remaining && !provider.supportsPartialRefunds()) {
      throw err('INVALID_ARGUMENT', `${original.provider} does not support partial refunds`);
    }
    // Convert the BWP refund back to the charged currency for the operator.
    const chargedAmount =
      original.currency && original.currency !== 'BWP'
        ? Math.round(refundBwp / (original.fx_rate || 1))
        : refundBwp;
    const intent = this.intents.insert({
      id: id('pin'),
      type: 'refund',
      provider: original.provider,
      msisdn_ref: original.msisdn_ref,
      amount_minor: refundBwp,
      charged_amount_minor: chargedAmount,
      currency: original.currency || 'BWP',
      partial: refundBwp < original.amount_minor,
      original_intent_id: intentId,
      dest_account_id: original.dest_account_id,
      actor_ref: actorRef || null,
      idempotency_key: idempotencyKey,
      state: 'initiated',
      provider_ref: null,
      created_at: this.clock.nowIso(),
    });
    this._dispatch(intent.id, () => {
      const result = provider.initiateRefund({
        originalProviderRef: original.provider_ref,
        amountMinor: chargedAmount,
        ref: `intent:${intent.id}`,
      });
      this.intents.update(intent.id, { state: 'pending_provider', provider_ref: result.provider_ref });
    });
    this.audit.append(actorRef || 'system:payments', 'payments.refund_initiated',
      `intent:${intent.id}`, null, { original_intent_id: intentId, amount_minor: refundBwp, partial: intent.partial });
    return this.intents.get(intent.id);
  }

  /**
   * Chargeback / dispute (WS1): the card network reverses a completed
   * collection. Reverses the ledger deposit (member account → clearing)
   * and opens a fraud review. This is a webhook-initiated flow but is
   * also callable by the admin dispute console.
   */
  processChargeback(intentId, { reasonCode = 'DISPUTE' } = {}) {
    const original = this._mustGet(intentId);
    if (original.type !== 'collection' || original.state === 'charged_back') {
      throw err('STATE_CONFLICT', 'Chargebacks apply to completed collections once');
    }
    const provider = this.provider(original.provider);
    if (!provider.supportsChargebacks()) {
      throw err('INVALID_ARGUMENT', `${original.provider} does not raise chargebacks`);
    }
    this.ledger.post({
      entries: [
        { account_id: original.dest_account_id, amount_minor: -original.amount_minor },
        { account_id: this.clearingAccountId(original.provider), amount_minor: original.amount_minor },
      ],
      purpose: 'provider_chargeback',
      ref: `intent:${original.id}`,
      idempotencyKey: `chargeback:${original.id}`,
    });
    const updated = this.intents.update(original.id, {
      state: 'charged_back',
      chargeback: { reason_code: reasonCode, at: this.clock.nowIso() },
    });
    // A chargeback is a fraud signal — queue it for review.
    this.fraud.events.insert({
      id: id('frd'),
      kind: 'chargeback',
      actor_ref: original.actor_ref,
      amount_minor: original.amount_minor,
      flags: [{ check: 'chargeback', action: 'review', detail: reasonCode }],
      ts: this.clock.nowIso(),
    });
    this.fraud.reviews.insert({
      id: id('frw'),
      kind: 'chargeback',
      check: 'chargeback',
      detail: `${provider.name} dispute ${reasonCode} on intent ${original.id}`,
      subject_ref: original.dest_account_id,
      state: 'open',
      ts: this.clock.nowIso(),
    });
    this.audit.append('system:payments', 'payments.chargeback', `intent:${original.id}`, null, {
      reason_code: reasonCode,
    });
    this.bus.publish('payments.intent.failed', {
      intent_id: original.id,
      provider: original.provider,
      reason: `chargeback:${reasonCode}`,
      actor_ref: original.actor_ref,
    });
    return updated;
  }

  // ── Webhooks (§13.2: forgery/replay/duplicate defences) ───────────

  processWebhook(providerName, rawBody, headers) {
    const provider = this.provider(providerName);
    const signature = headers['x-motse-signature'];
    const timestamp = headers['x-motse-timestamp'];
    const nonce = headers['x-motse-nonce'];

    const versions = this.secrets.validForVerification(provider.secretName);
    if (!verifySignature(versions, { timestamp, nonce, rawBody, signature })) {
      this.bus.publish('payments.webhook.rejected', { provider: providerName, reason: 'bad_signature' });
      throw err('PERMISSION_DENIED', 'Webhook signature verification failed');
    }
    try {
      this.replayGuard.assertFresh(timestamp, nonce);
    } catch (e) {
      this.bus.publish('payments.webhook.rejected', { provider: providerName, reason: 'replay' });
      throw e;
    }

    const parsed = provider.parseWebhook(JSON.parse(rawBody));
    // A chargeback references the ORIGINAL collection's provider_ref (it
    // is a later event on the same transaction), so its dedupe key is
    // suffixed and it routes before the standard duplicate/amount checks.
    const isChargeback = parsed.outcome === 'chargeback' || parsed.event === 'chargeback';
    const dedupeRef = isChargeback ? `${parsed.provider_ref}:cb` : parsed.provider_ref;
    const dupe = this.webhookLog.findOne(
      (w) => w.provider === providerName && w.provider_ref === dedupeRef
    );
    if (dupe) {
      return { duplicate: true, intent_id: dupe.intent_id };
    }
    const intent = this.intents.findOne(
      (i) => i.provider === providerName && i.provider_ref === parsed.provider_ref
    );
    if (!intent) {
      this.bus.publish('payments.webhook.rejected', { provider: providerName, reason: 'unknown_ref' });
      throw err('NOT_FOUND', `No intent for provider ref ${parsed.provider_ref}`);
    }
    if (isChargeback) {
      const outcome = this.processChargeback(intent.id, { reasonCode: parsed.failure_reason });
      this.webhookLog.insert({
        id: id('pwh'), provider: providerName, provider_ref: dedupeRef,
        intent_id: intent.id, outcome: 'chargeback', ts: this.clock.nowIso(),
      });
      return outcome;
    }
    // Amount check: multi-currency intents are validated against the
    // charged amount (the currency the operator actually moved).
    const expected =
      intent.currency && intent.currency !== 'BWP'
        ? intent.charged_amount_minor
        : intent.amount_minor;
    if (parsed.amount_minor !== undefined && parsed.amount_minor !== expected) {
      this.bus.publish('payments.webhook.rejected', { provider: providerName, reason: 'amount_mismatch' });
      throw err('STATE_CONFLICT', 'Webhook amount does not match the intent');
    }
    // Settle FIRST, log after: if settlement throws (e.g. transient
    // ledger issue) the operator's retry can re-attempt — the ledger's
    // own idempotency keys make the retry safe, and a logged webhook
    // permanently blocks duplicates.
    const outcome = this._settleIntent(intent, parsed);
    this.webhookLog.insert({
      id: id('pwh'),
      provider: providerName,
      provider_ref: parsed.provider_ref,
      intent_id: intent.id,
      outcome: parsed.outcome,
      ts: this.clock.nowIso(),
    });
    return outcome;
  }

  _settleIntent(intent, parsed) {
    if (parsed.outcome === 'success') {
      if (intent.type === 'collection') {
        this.ledger.providerDeposit({
          providerAccountId: this.clearingAccountId(intent.provider),
          destAccountId: intent.dest_account_id,
          amountMinor: intent.amount_minor,
          providerTxRef: `intent:${intent.id}`,
          idempotencyKey: `collect:${intent.id}`,
        });
      } else if (intent.type === 'payout') {
        this.ledger.settlePayout(intent.ledger_payout_id, parsed.provider_receipt);
      } else if (intent.type === 'refund') {
        // Reverse the original deposit: member account → clearing.
        this.ledger.post({
          entries: [
            { account_id: intent.dest_account_id, amount_minor: -intent.amount_minor },
            { account_id: this.clearingAccountId(intent.provider), amount_minor: intent.amount_minor },
          ],
          purpose: 'provider_refund',
          ref: `intent:${intent.id}`,
          idempotencyKey: `refund:${intent.id}`,
        });
        // Mark the original fully or partially refunded based on the
        // cumulative settled refunds — a partial keeps it refundable.
        const original = this.intents.get(intent.original_intent_id);
        const settledRefunds = this.intents
          .find(
            (i) =>
              i.type === 'refund' &&
              i.original_intent_id === intent.original_intent_id &&
              (i.state === 'completed' || i.id === intent.id)
          )
          .reduce((s, i) => s + i.amount_minor, 0);
        this.intents.update(intent.original_intent_id, {
          state: settledRefunds >= original.amount_minor ? 'refunded' : 'partially_refunded',
          refunded_minor: settledRefunds,
        });
      }
      const completed = this.intents.update(intent.id, {
        state: 'completed',
        provider_receipt: parsed.provider_receipt,
        completed_at: this.clock.nowIso(),
      });
      this.bus.publish('payments.intent.completed', {
        intent_id: intent.id,
        provider: intent.provider,
        type: intent.type,
        actor_ref: intent.actor_ref,
        amount_minor: intent.amount_minor,
      });
      return completed;
    }
    // Failure outcome.
    if (intent.type === 'payout') {
      this.ledger.failPayout(intent.ledger_payout_id, parsed.failure_reason);
    }
    const failed = this.intents.update(intent.id, {
      state: 'failed',
      failure_reason: parsed.failure_reason,
      failed_at: this.clock.nowIso(),
    });
    this.bus.publish('payments.intent.failed', {
      intent_id: intent.id,
      provider: intent.provider,
      reason: parsed.failure_reason,
      actor_ref: intent.actor_ref,
    });
    return failed;
  }

  // ── Lookup / verification ──────────────────────────────────────────

  /** Poll the operator and sync a stuck intent (webhook lost). */
  verify(intentId) {
    const intent = this._mustGet(intentId);
    if (!intent.provider_ref) return intent;
    if (['completed', 'failed', 'refunded'].includes(intent.state)) return intent;
    const provider = this.provider(intent.provider);
    const remote = provider.verifyTransaction(intent.provider_ref);
    if (!remote.found) return intent;
    if (remote.state === 'completed') {
      return this._settleIntent(intent, {
        outcome: 'success',
        amount_minor: remote.amount_minor,
        provider_receipt: remote.provider_receipt,
      });
    }
    if (remote.state === 'failed') {
      return this._settleIntent(intent, {
        outcome: 'failure',
        failure_reason: 'verified_failed_at_provider',
      });
    }
    return intent;
  }

  // ── Reconciliation (§9.2 nightly job) ──────────────────────────────

  reconcileDaily(providerName, dateIso) {
    const provider = this.provider(providerName);
    const statement = provider.fetchStatement(dateIso || this.clock.nowIso());
    // Ledger postings reference `intent:{id}`; statements use the same
    // refs. Multi-currency lines are converted to the BWP amount that
    // actually hit the clearing account, so the match is apples-to-apples.
    const report = this.ledger.reconcile(
      this.clearingAccountId(providerName),
      statement.map((line) => {
        const bwpMinor =
          line.currency && line.currency !== 'BWP'
            ? provider.fxToBwpMinor(line.amount_minor, line.currency).bwpMinor
            : line.amount_minor;
        return { ref: line.ref, amount_minor: bwpMinor };
      })
    );
    return { provider: providerName, ...report };
  }

  /** Drain the transient-failure retry queue (scheduler entry point). */
  drainRetries() {
    return this.retryQueue.drain();
  }

  intent(intentId) {
    return this._mustGet(intentId);
  }

  listIntents(filter = {}) {
    return this.intents.find((i) => {
      if (filter.provider && i.provider !== filter.provider) return false;
      if (filter.state && i.state !== filter.state) return false;
      if (filter.type && i.type !== filter.type) return false;
      return true;
    });
  }

  _dispatch(intentId, fn) {
    try {
      fn();
    } catch (e) {
      if (e.transient) {
        // Operator hiccup: keep the intent, retry with backoff.
        this.intents.update(intentId, { state: 'retrying', last_error: e.message });
        this.retryQueue.enqueue(`dispatch:${intentId}`, () => {
          fn();
        });
        return;
      }
      this.intents.update(intentId, { state: 'failed', failure_reason: e.message });
      throw e;
    }
  }

  _mustGet(intentId) {
    const intent = this.intents.get(intentId);
    if (!intent) throw err('NOT_FOUND', `No payment intent ${intentId}`);
    return intent;
  }
}

module.exports = { PaymentService };
