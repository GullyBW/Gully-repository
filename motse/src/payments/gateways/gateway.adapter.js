'use strict';

const crypto = require('crypto');
const { err } = require('../../kernel/errors');

/**
 * GatewayAdapter (Phase 4, WS2) — the second abstraction layer beneath
 * CardPaymentProvider. The card provider talks ONLY to this interface,
 * never to a concrete gateway, so Stripe/Adyen/Braintree/Peach/DPO/
 * PayGate (and any future gateway) are interchangeable and selectable by
 * configuration.
 *
 * PCI posture (WS3/WS10): the platform NEVER sees a PAN, CVV, PIN, EMV
 * secret or magnetic-stripe data. Card data is entered into the
 * gateway's Hosted Checkout / Hosted Payment Fields and exchanged for a
 * gateway-issued TOKEN. Only tokens ever cross this boundary; this
 * sandbox models that by accepting an opaque `hosted_field_ref` and
 * returning tokens — it deliberately has no PAN parameter anywhere.
 *
 * Each adapter implements the full contract; the base provides a
 * faithful sandbox so the entire lifecycle (intent → tokenize → 3DS →
 * authorize → capture → refund → settle → reconcile) runs end-to-end in
 * CI, with fault injection for failover/timeout/retry testing.
 */
const CARD_BRANDS = {
  // BIN prefixes → brand (illustrative; production uses the gateway's own
  // brand detection — the platform never inspects a real PAN).
  '4': 'visa',
  '51': 'mastercard', '52': 'mastercard', '53': 'mastercard', '54': 'mastercard', '55': 'mastercard',
  '34': 'amex', '37': 'amex',
  '6011': 'discover', '65': 'discover',
};

class GatewayAdapter {
  constructor(name, { clock, secrets }, options = {}) {
    this.name = name;
    this.clock = clock;
    this.secrets = secrets;
    this.live = !!options.live;
    this.credentials = options.credentials || null;
    // Which brands this gateway routes. Future networks are added by
    // config, not code (WS1).
    this.supportedBrands = options.supportedBrands || ['visa', 'mastercard', 'amex', 'discover'];
    this.supportedCurrencies = options.supportedCurrencies || [
      'BWP', 'USD', 'EUR', 'GBP', 'ZAR', 'NAD', 'KES', 'TZS', 'UGX',
    ];
    this.secretName = `gateway:${name}`;
    this.secrets.seed(this.secretName, `sandbox-${name}-webhook-secret`);

    // Sandbox gateway state.
    this.tokens = new Map(); // token -> { brand, last4, exp_month, exp_year, network_token? }
    this.customers = new Map(); // customer_token -> { tokens: Set }
    this.intents = new Map(); // gw_ref -> intent record
    this._healthy = true;
    this.faults = {
      failNextAuthorize: 0, // transient failures for retry/failover tests
      timeoutNext: 0,
      declineNext: 0,
      threeDSChallenge: false,
    };
    this.latencies = []; // observed op latencies (ms) for health metrics
  }

  // ── Capability & routing ───────────────────────────────────────────

  supportsBrand(brand) {
    return this.supportedBrands.includes(brand);
  }

  supportsCurrency(currency) {
    return this.supportedCurrencies.includes(currency);
  }

  static brandFromBin(binOrToken) {
    const digits = String(binOrToken || '').replace(/\D/g, '');
    for (let len = 4; len >= 1; len -= 1) {
      const brand = CARD_BRANDS[digits.slice(0, len)];
      if (brand) return brand;
    }
    return 'unknown';
  }

  // ── Tokenization (WS3) ─────────────────────────────────────────────

  /**
   * Exchange a hosted-field reference for a gateway token. The platform
   * supplies ONLY the opaque reference the gateway's hosted fields
   * produced plus non-sensitive display metadata (brand, last4, expiry)
   * that the gateway itself returns — never a PAN.
   */
  tokenize({ hostedFieldRef, brand, last4, expMonth, expYear, customerToken, networkToken = false }) {
    this._assertHealthy();
    if (!hostedFieldRef) throw err('INVALID_ARGUMENT', 'hosted_field_ref is required (no raw PAN)');
    if (!this.supportsBrand(brand)) {
      throw err('INVALID_ARGUMENT', `${this.name} does not route ${brand}`);
    }
    const token = `tok_${this.name}_${crypto.randomBytes(8).toString('hex')}`;
    this.tokens.set(token, {
      token,
      brand,
      last4: String(last4 || '0000').slice(-4),
      exp_month: expMonth || null,
      exp_year: expYear || null,
      // Network tokens (WS3) — a network-issued token distinct from the
      // gateway token, where the network supports it.
      network_token: networkToken ? `ntk_${crypto.randomBytes(8).toString('hex')}` : null,
      customer_token: customerToken || null,
    });
    if (customerToken) {
      if (!this.customers.has(customerToken)) this.customers.set(customerToken, { tokens: new Set() });
      this.customers.get(customerToken).tokens.add(token);
    }
    return { ...this.tokens.get(token) };
  }

  /** Create a customer vault token (WS3 customer tokens). */
  createCustomer() {
    const customerToken = `cus_${this.name}_${crypto.randomBytes(8).toString('hex')}`;
    this.customers.set(customerToken, { tokens: new Set() });
    return { customer_token: customerToken };
  }

  updateTokenExpiry(token, { expMonth, expYear }) {
    const record = this._token(token);
    record.exp_month = expMonth;
    record.exp_year = expYear;
    return { ...record };
  }

  deleteToken(token) {
    const record = this.tokens.get(token);
    if (record && record.customer_token && this.customers.has(record.customer_token)) {
      this.customers.get(record.customer_token).tokens.delete(token);
    }
    return this.tokens.delete(token);
  }

  // ── 3-D Secure (WS4) ───────────────────────────────────────────────

  /**
   * Risk-based authentication. Returns a frictionless result unless a
   * challenge is required; the challenge is completed out-of-band and
   * confirmed via complete3DS. Produces liability-shift metadata.
   */
  authenticate3DS({ token, amountMinor, currency }) {
    this._assertHealthy();
    this._token(token);
    const challenge = this.faults.threeDSChallenge;
    const ref = `tds_${crypto.randomBytes(8).toString('hex')}`;
    const record = {
      three_ds_ref: ref,
      version: '2.2.0',
      flow: challenge ? 'challenge' : 'frictionless',
      status: challenge ? 'challenge_required' : 'authenticated',
      // Liability shift metadata (WS4).
      liability_shift: !challenge, // frictionless RBA shifts immediately
      acs_url: challenge ? `/3ds/challenge/${ref}` : null,
      eci: challenge ? null : '05',
      cavv: challenge ? null : crypto.randomBytes(10).toString('base64'),
      amount_minor: amountMinor,
      currency,
    };
    this.intents.set(ref, { type: '3ds', ...record });
    return record;
  }

  /** Complete a challenge flow (WS4 challenge → liability shift). */
  complete3DS(threeDsRef, { success = true } = {}) {
    const record = this.intents.get(threeDsRef);
    if (!record || record.type !== '3ds') throw err('NOT_FOUND', `No 3DS ${threeDsRef}`);
    record.status = success ? 'authenticated' : 'failed';
    record.liability_shift = success;
    record.eci = success ? '05' : null;
    record.cavv = success ? crypto.randomBytes(10).toString('base64') : null;
    return {
      three_ds_ref: threeDsRef,
      version: record.version,
      flow: 'challenge',
      status: record.status,
      liability_shift: record.liability_shift,
      eci: record.eci,
      cavv: record.cavv,
    };
  }

  // ── Authorization / capture lifecycle (WS5) ────────────────────────

  authorize({ token, amountMinor, currency, threeDs, ref }) {
    this._runFaults('authorize');
    this._token(token);
    if (!this.supportsCurrency(currency)) {
      throw err('INVALID_ARGUMENT', `${this.name} does not settle ${currency}`);
    }
    if (this.faults.declineNext > 0) {
      this.faults.declineNext -= 1;
      const gwRef = `auth_${crypto.randomBytes(8).toString('hex')}`;
      this.intents.set(gwRef, { gw_ref: gwRef, state: 'declined', token, amount_minor: amountMinor, currency });
      return { gw_ref: gwRef, state: 'declined', decline_reason: 'DO_NOT_HONOR' };
    }
    const gwRef = `auth_${crypto.randomBytes(8).toString('hex')}`;
    this.intents.set(gwRef, {
      gw_ref: gwRef,
      state: 'authorized',
      token,
      amount_minor: amountMinor,
      captured_minor: 0,
      refunded_minor: 0,
      currency,
      three_ds: threeDs || null,
      ref,
      created_at: this.clock.nowIso(),
    });
    return { gw_ref: gwRef, state: 'authorized', amount_minor: amountMinor };
  }

  capture(gwRef, { amountMinor } = {}) {
    const auth = this._intent(gwRef);
    if (auth.state !== 'authorized' && auth.state !== 'partially_captured') {
      throw err('STATE_CONFLICT', `Cannot capture from ${auth.state}`);
    }
    const remaining = auth.amount_minor - auth.captured_minor;
    const amount = amountMinor === undefined ? remaining : amountMinor;
    if (amount <= 0 || amount > remaining) {
      throw err('STATE_CONFLICT', 'Capture exceeds the authorized remaining amount', {
        remaining_minor: remaining,
      });
    }
    auth.captured_minor += amount;
    auth.state = auth.captured_minor >= auth.amount_minor ? 'captured' : 'partially_captured';
    return {
      gw_ref: gwRef,
      state: auth.state,
      captured_minor: auth.captured_minor,
      amount_minor: amount,
      receipt: `${this.name}-cap-${gwRef.slice(-6)}`,
    };
  }

  voidAuthorization(gwRef) {
    const auth = this._intent(gwRef);
    if (!['authorized', 'partially_captured'].includes(auth.state)) {
      throw err('STATE_CONFLICT', `Cannot void from ${auth.state}`);
    }
    auth.state = 'voided';
    return { gw_ref: gwRef, state: 'voided' };
  }

  refund(gwRef, { amountMinor } = {}) {
    const auth = this._intent(gwRef);
    if (!['captured', 'partially_captured', 'partially_refunded'].includes(auth.state)) {
      throw err('STATE_CONFLICT', `Cannot refund from ${auth.state}`);
    }
    const refundable = auth.captured_minor - auth.refunded_minor;
    const amount = amountMinor === undefined ? refundable : amountMinor;
    if (amount <= 0 || amount > refundable) {
      throw err('STATE_CONFLICT', 'Refund exceeds the captured remaining amount', {
        refundable_minor: refundable,
      });
    }
    auth.refunded_minor += amount;
    if (auth.refunded_minor >= auth.captured_minor) auth.state = 'refunded';
    else auth.state = 'partially_refunded';
    return {
      gw_ref: gwRef,
      state: auth.state,
      refunded_minor: auth.refunded_minor,
      amount_minor: amount,
      receipt: `${this.name}-ref-${crypto.randomBytes(4).toString('hex')}`,
    };
  }

  verify(gwRef) {
    const auth = this.intents.get(gwRef);
    return auth ? { found: true, state: auth.state, amount_minor: auth.amount_minor } : { found: false };
  }

  // ── Settlement & reconciliation (WS5) ──────────────────────────────

  /** Daily settlement file the platform reconciles postings against. */
  settlementFile(dateIso) {
    const day = String(dateIso).slice(0, 10);
    const lines = [];
    for (const intent of this.intents.values()) {
      if (intent.type === '3ds') continue;
      if (intent.captured_minor > 0) {
        lines.push({
          ref: intent.ref,
          gw_ref: intent.gw_ref,
          amount_minor: intent.captured_minor - intent.refunded_minor,
          currency: intent.currency,
          day,
        });
      }
    }
    return lines;
  }

  // ── Webhooks (WS10 secure validation) ──────────────────────────────

  /** Sandbox: emit a signed webhook exactly as the gateway would send. */
  signWebhook(body, { nonce } = {}) {
    const rawBody = JSON.stringify(body);
    const timestamp = this.clock.nowMs();
    const theNonce = nonce || crypto.randomBytes(8).toString('hex');
    const signature = crypto
      .createHmac('sha256', this.secrets.current(this.secretName).value)
      .update(`${timestamp}.${theNonce}.${rawBody}`)
      .digest('hex');
    return {
      rawBody,
      headers: {
        'x-motse-signature': signature,
        'x-motse-timestamp': String(timestamp),
        'x-motse-nonce': theNonce,
      },
    };
  }

  parseWebhook(body) {
    return {
      gw_ref: body.gw_ref,
      event: body.event, // captured | refunded | chargeback | dispute | settled
      amount_minor: body.amount_minor,
      currency: body.currency,
      reason_code: body.reason_code || null,
    };
  }

  // ── Health (WS11 gateway status/health) ────────────────────────────

  health() {
    const recent = this.latencies.slice(-50);
    const avg = recent.length ? Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) : 0;
    return {
      gateway: this.name,
      healthy: this._healthy,
      mode: this.live ? 'live' : 'sandbox',
      avg_latency_ms: avg,
      supported_brands: this.supportedBrands,
      supported_currencies: this.supportedCurrencies,
    };
  }

  setHealthy(healthy) {
    this._healthy = healthy;
  }

  _assertHealthy() {
    if (!this._healthy) {
      const e = err('INTERNAL', `${this.name} is unhealthy`);
      e.transient = true;
      throw e;
    }
  }

  _runFaults(op) {
    const started = this.clock.nowMs();
    this._assertHealthy();
    if (this.faults.timeoutNext > 0) {
      this.faults.timeoutNext -= 1;
      const e = err('INTERNAL', `${this.name} ${op} timed out`);
      e.transient = true;
      throw e;
    }
    if (this.faults.failNextAuthorize > 0) {
      this.faults.failNextAuthorize -= 1;
      const e = err('INTERNAL', `${this.name} ${op} failed`);
      e.transient = true;
      throw e;
    }
    this.latencies.push(this.clock.nowMs() - started);
  }

  _token(token) {
    const record = this.tokens.get(token);
    if (!record) throw err('NOT_FOUND', `No token ${token} at ${this.name}`);
    return record;
  }

  _intent(gwRef) {
    const intent = this.intents.get(gwRef);
    if (!intent) throw err('NOT_FOUND', `No gateway intent ${gwRef}`);
    return intent;
  }
}

module.exports = { GatewayAdapter, CARD_BRANDS };
