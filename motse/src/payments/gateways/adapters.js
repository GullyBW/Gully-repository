'use strict';

const { GatewayAdapter } = require('./gateway.adapter');

/**
 * Concrete gateway adapters (Phase 4, WS2). Each subclass declares only
 * its routing profile (brands, currencies, regional strengths); the
 * base GatewayAdapter provides the faithful sandbox lifecycle. Adding a
 * future gateway is a new subclass + registration — the CardPayment
 * provider and every service above it are unchanged.
 */
class StripeGateway extends GatewayAdapter {
  constructor(deps, options = {}) {
    super('stripe', deps, {
      supportedBrands: ['visa', 'mastercard', 'amex', 'discover'],
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'ZAR', 'BWP', 'NAD', 'KES', 'TZS', 'UGX'],
      ...options,
    });
  }
}

class AdyenGateway extends GatewayAdapter {
  constructor(deps, options = {}) {
    super('adyen', deps, {
      supportedBrands: ['visa', 'mastercard', 'amex', 'discover'],
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'ZAR', 'KES', 'TZS', 'UGX', 'BWP', 'NAD'],
      ...options,
    });
  }
}

class BraintreeGateway extends GatewayAdapter {
  constructor(deps, options = {}) {
    super('braintree', deps, {
      supportedBrands: ['visa', 'mastercard', 'amex', 'discover'],
      supportedCurrencies: ['USD', 'EUR', 'GBP', 'ZAR', 'BWP'],
      ...options,
    });
  }
}

/** Peach Payments — strong Southern-African acquiring. */
class PeachGateway extends GatewayAdapter {
  constructor(deps, options = {}) {
    super('peach', deps, {
      supportedBrands: ['visa', 'mastercard', 'amex'],
      supportedCurrencies: ['ZAR', 'BWP', 'NAD', 'USD', 'KES'],
      ...options,
    });
  }
}

/** DPO Pay — pan-African acquiring. */
class DpoGateway extends GatewayAdapter {
  constructor(deps, options = {}) {
    super('dpo', deps, {
      supportedBrands: ['visa', 'mastercard'],
      supportedCurrencies: ['BWP', 'ZAR', 'NAD', 'KES', 'TZS', 'UGX', 'USD'],
      ...options,
    });
  }
}

/** PayGate — South African acquiring. */
class PayGateGateway extends GatewayAdapter {
  constructor(deps, options = {}) {
    super('paygate', deps, {
      supportedBrands: ['visa', 'mastercard'],
      supportedCurrencies: ['ZAR', 'BWP', 'NAD', 'USD'],
      ...options,
    });
  }
}

const GATEWAY_CLASSES = {
  stripe: StripeGateway,
  adyen: AdyenGateway,
  braintree: BraintreeGateway,
  peach: PeachGateway,
  dpo: DpoGateway,
  paygate: PayGateGateway,
};

module.exports = {
  StripeGateway,
  AdyenGateway,
  BraintreeGateway,
  PeachGateway,
  DpoGateway,
  PayGateGateway,
  GATEWAY_CLASSES,
};
