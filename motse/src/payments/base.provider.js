'use strict';

const crypto = require('crypto');
const { err } = require('../kernel/errors');
const { signPayload } = require('../security/replay');

/**
 * Payment provider contract (Phase-1 payments). Every Botswana provider
 * (Orange Money, MyZaka, BeMobile Smega) implements exactly this
 * surface; the PaymentService and the Ledger own ALL business logic —
 * a provider only translates between Motse and the operator API.
 *
 * Sandbox mode: without live credentials each provider simulates the
 * operator end (accepted transactions, statements, webhooks) so the
 * full flow — initiate → webhook → ledger posting → reconciliation —
 * is exercisable end-to-end. Going live is configuration, not code:
 * pass `live: true` + credentials and implement the HTTP calls in the
 * subclass `_dispatch` hooks.
 */
class PaymentProvider {
  /**
   * @param {string} name        registry key, e.g. 'orange_money'
   * @param {object} deps        { clock, secrets }
   * @param {object} options     { live, credentials, capabilities }
   */
  constructor(name, { clock, secrets }, options = {}) {
    this.name = name;
    this.clock = clock;
    this.secrets = secrets;
    this.live = !!options.live;
    this.credentials = options.credentials || null;
    this.capabilities = {
      c2b: true, // customer-to-business collections
      b2c: true, // business-to-customer payouts
      refunds: true,
      ...options.capabilities,
    };
    // Webhook signing secret for this provider (rotated via SecretManager).
    this.secretName = `webhook:${name}`;
    this.secrets.seed(this.secretName, `sandbox-${name}-secret`);

    // Sandbox operator state.
    this.sandboxTxns = new Map(); // provider_ref -> txn
    this.sandboxBalanceMinor = 100000000; // float the operator holds for us
    this.faults = { failNextInitiate: 0, omitFromStatement: new Set() };
  }

  // ── Contract ───────────────────────────────────────────────────────

  /** C2B: ask the operator to collect from a subscriber wallet. */
  initiateCollection({ msisdn, amountMinor, ref }) {
    this._requireCapability('c2b');
    return this._sandboxInitiate({ type: 'collection', msisdn, amountMinor, ref });
  }

  /** B2C: push money to a subscriber wallet. */
  initiatePayout({ msisdn, amountMinor, ref }) {
    this._requireCapability('b2c');
    return this._sandboxInitiate({ type: 'payout', msisdn, amountMinor, ref });
  }

  /** Refund a completed collection (where the operator supports it). */
  initiateRefund({ originalProviderRef, amountMinor, ref }) {
    this._requireCapability('refunds');
    const original = this.sandboxTxns.get(originalProviderRef);
    if (!original || original.type !== 'collection' || original.state !== 'completed') {
      throw err('STATE_CONFLICT', 'Refund requires a completed collection at the provider');
    }
    return this._sandboxInitiate({
      type: 'refund',
      msisdn: original.msisdn,
      amountMinor,
      ref,
      original_provider_ref: originalProviderRef,
    });
  }

  /** Transaction lookup / status verification against the operator. */
  verifyTransaction(providerRef) {
    const txn = this.sandboxTxns.get(providerRef);
    if (!txn) return { found: false };
    return {
      found: true,
      state: txn.state,
      type: txn.type,
      amount_minor: txn.amount_minor,
      provider_receipt: txn.receipt || null,
    };
  }

  getStatus(providerRef) {
    const txn = this.sandboxTxns.get(providerRef);
    return txn ? txn.state : 'unknown';
  }

  balanceCheck() {
    return { provider: this.name, available_minor: this.sandboxBalanceMinor };
  }

  /**
   * Daily settlement statement for reconciliation. Sandbox generates it
   * from the operator-side transaction log; fault hooks let tests
   * inject missing/duplicated lines.
   */
  fetchStatement(dateIso) {
    const day = String(dateIso).slice(0, 10);
    const lines = [];
    for (const txn of this.sandboxTxns.values()) {
      if (txn.state !== 'completed') continue;
      if (txn.completed_at && txn.completed_at.slice(0, 10) !== day) continue;
      if (this.faults.omitFromStatement.has(txn.provider_ref)) continue;
      lines.push({ ref: txn.ref, amount_minor: txn.amount_minor, type: txn.type });
    }
    return lines;
  }

  /**
   * Normalise an operator webhook body to the shared shape. Subclasses
   * override to map operator-specific field names.
   */
  parseWebhook(body) {
    return {
      provider_ref: body.provider_ref,
      outcome: body.outcome, // 'success' | 'failure'
      amount_minor: body.amount_minor,
      provider_receipt: body.receipt || null,
      failure_reason: body.failure_reason || null,
    };
  }

  // ── Sandbox operator behaviour ─────────────────────────────────────

  _sandboxInitiate({ type, msisdn, amountMinor, ref, ...extra }) {
    if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
      throw err('INVALID_ARGUMENT', 'amount_minor must be a positive integer');
    }
    if (this.faults.failNextInitiate > 0) {
      this.faults.failNextInitiate -= 1;
      const transient = new Error(`${this.name}: operator temporarily unavailable`);
      transient.transient = true;
      throw transient;
    }
    const providerRef = `${this.name.toUpperCase()}-${crypto.randomBytes(6).toString('hex')}`;
    this.sandboxTxns.set(providerRef, {
      provider_ref: providerRef,
      type,
      msisdn,
      amount_minor: amountMinor,
      ref,
      state: 'pending',
      created_at: this.clock.nowIso(),
      ...extra,
    });
    return { provider_ref: providerRef, state: 'pending' };
  }

  /**
   * Sandbox: the operator resolves a transaction and "sends" us the
   * signed webhook. Returns { rawBody, headers } exactly as the HTTP
   * endpoint would receive them — tests and the dev portal post these
   * to /v1/payments/webhooks/{provider}.
   */
  sandboxResolve(providerRef, outcome, { nonce } = {}) {
    const txn = this.sandboxTxns.get(providerRef);
    if (!txn) throw err('NOT_FOUND', `No sandbox txn ${providerRef}`);
    txn.state = outcome === 'success' ? 'completed' : 'failed';
    txn.completed_at = this.clock.nowIso();
    txn.receipt = outcome === 'success' ? `${this.name}-rcpt-${providerRef.slice(-6)}` : null;
    if (txn.type === 'payout' && outcome === 'success') {
      this.sandboxBalanceMinor -= txn.amount_minor;
    }
    if (txn.type === 'collection' && outcome === 'success') {
      this.sandboxBalanceMinor += txn.amount_minor;
    }
    const body = this._webhookBody(txn, outcome);
    const rawBody = JSON.stringify(body);
    const timestamp = this.clock.nowMs();
    const theNonce = nonce || crypto.randomBytes(8).toString('hex');
    const signature = signPayload(
      this.secrets.current(this.secretName).value,
      timestamp,
      theNonce,
      rawBody
    );
    return {
      rawBody,
      headers: {
        'x-motse-signature': signature,
        'x-motse-timestamp': String(timestamp),
        'x-motse-nonce': theNonce,
      },
    };
  }

  /** Operator-flavoured webhook body; overridden per provider. */
  _webhookBody(txn, outcome) {
    return {
      provider_ref: txn.provider_ref,
      outcome,
      amount_minor: txn.amount_minor,
      receipt: txn.receipt,
      failure_reason: outcome === 'success' ? null : 'SUBSCRIBER_DECLINED',
    };
  }

  _requireCapability(capability) {
    if (!this.capabilities[capability]) {
      throw err('INVALID_ARGUMENT', `${this.name} does not support ${capability}`);
    }
  }
}

module.exports = { PaymentProvider };
