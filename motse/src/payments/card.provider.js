'use strict';

const { PaymentProvider } = require('./base.provider');
const { GatewayAdapter } = require('./gateways/gateway.adapter');
const { err } = require('../kernel/errors');

/**
 * CardPaymentProvider (Phase 4, WS1) — native debit & credit cards as a
 * first-class member of the existing PaymentProvider family. It
 * satisfies the full PaymentProvider contract (so it registers with
 * PaymentService, gets a ledger clearing account, and participates in
 * capability discovery + reconciliation exactly like the others) while
 * delegating the actual card work to interchangeable GatewayAdapters
 * through the GatewayRegistry (WS2). It never depends on a specific
 * gateway and never sees a PAN/CVV/PIN.
 *
 * The richer card lifecycle (authorize→capture, partial capture, void,
 * subscriptions, saved cards, 3DS) lives in CardService, which uses this
 * provider's gateway registry; the provider itself exposes the plain
 * PaymentProvider surface plus the card capability flags.
 */

// Expanded multi-currency FX (WS8): BWP-per-unit. The ledger stays in
// BWP thebe; every card intent stores the original currency, settlement
// currency, rate, timestamp, provider ref and converted amount.
const CARD_FX = {
  BWP: 1,
  USD: 13.5,
  EUR: 14.6,
  GBP: 17.1,
  ZAR: 0.74,
  NAD: 0.74,
  KES: 0.105,
  TZS: 0.0053,
  UGX: 0.0036,
};

class CardPaymentProvider extends PaymentProvider {
  constructor(deps, options = {}) {
    super('card', deps, {
      capabilities: {
        c2b: true,
        b2c: true, // refunds/payouts to the card via the gateway
        refunds: true,
        partial_refunds: true,
        recurring: true,
        subscriptions: true,
        escrow: false, // Motse escrow is the Ledger's, not the gateway's
        multi_currency: true,
        webhooks: true,
        chargebacks: true,
        currencies: ['BWP', 'USD', 'EUR', 'GBP', 'ZAR', 'NAD', 'KES', 'TZS', 'UGX'],
        countries: ['BW', 'ZA', 'NA', 'KE', 'TZ', 'UG', 'US', 'GB', 'DE', 'FR'],
      },
      ...options,
    });
    this.fxRates = options.fxRates || CARD_FX;
    this.gateways = options.gateways; // GatewayRegistry (required for live card ops)
    // Card brands supported platform-wide; future networks via config (WS1).
    this.brands = options.brands || ['visa', 'mastercard', 'amex', 'discover'];
  }

  supportsBrand(brand) {
    return this.brands.includes(brand);
  }

  /** Detect brand from a BIN/token prefix (no PAN ever inspected). */
  static brandOf(binOrToken) {
    return GatewayAdapter.brandFromBin(binOrToken);
  }

  /**
   * A plain collection routes through the card lifecycle as an
   * immediate authorize+capture on a token. PaymentService.collect calls
   * this; the token + brand come in via the ref envelope so no raw card
   * data reaches the provider. For the full auth/capture/subscription
   * lifecycle callers use CardService directly.
   */
  initiateCollection({ amountMinor, currency = 'BWP', ref, token, brand }) {
    this._requireCapability('c2b');
    if (!this.gateways) {
      // Sandbox fallback keeps the plain contract testable without a
      // configured registry (mirrors the mobile-money sandbox).
      return this._sandboxInitiate({ type: 'collection', amountMinor, currency, ref });
    }
    if (!token) throw err('INVALID_ARGUMENT', 'A gateway token is required (no raw PAN)');
    const cardBrand = brand || CardPaymentProvider.brandOf(token);
    const { result, gateway } = this.gateways.route(
      { brand: cardBrand, currency, op: 'authorize' },
      (gw) => {
        const auth = gw.authorize({ token, amountMinor, currency, ref });
        if (auth.state === 'declined') return auth;
        return gw.capture(auth.gw_ref);
      }
    );
    return { provider_ref: result.gw_ref, state: result.state === 'declined' ? 'declined' : 'captured', gateway };
  }

  /** Refund to the card via the issuing gateway. */
  initiateRefund({ originalProviderRef, amountMinor, ref, gateway, brand = 'visa', currency = 'BWP' }) {
    this._requireCapability('refunds');
    if (!this.gateways) {
      return super.initiateRefund({ originalProviderRef, amountMinor, ref });
    }
    const { result, gateway: usedGateway } = this.gateways.route(
      { brand, currency, op: 'refund', preferred: gateway },
      (gw) => gw.refund(originalProviderRef, { amountMinor })
    );
    return { provider_ref: result.gw_ref, state: 'refund_pending', gateway: usedGateway };
  }

  /** Gateway settlement files feed reconciliation (WS5). */
  fetchStatement(dateIso) {
    if (!this.gateways) return super.fetchStatement(dateIso);
    const lines = [];
    for (const gw of this.gateways.gateways.values()) {
      for (const line of gw.settlementFile(dateIso)) {
        lines.push({ ...line, gateway: gw.name });
      }
    }
    return lines;
  }

  parseWebhook(body) {
    return {
      provider_ref: body.gw_ref,
      outcome:
        body.event === 'chargeback' || body.event === 'dispute'
          ? 'chargeback'
          : body.event === 'declined'
            ? 'failure'
            : 'success',
      amount_minor: body.amount_minor,
      currency: body.currency,
      event: body.event,
      failure_reason: body.reason_code || null,
    };
  }
}

module.exports = { CardPaymentProvider, CARD_FX };
