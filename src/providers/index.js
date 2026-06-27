'use strict';

const config = require('../config');
const { PAYMENT_METHODS } = require('../utils/constants');
const OrangeMoneyProvider = require('./orangeMoney.provider');
const MyZakaProvider = require('./myZaka.provider');
const BankTransferProvider = require('./bankTransfer.provider');
const CardProvider = require('./card.provider');

/**
 * Provider registry. Maps a payment method to a ready-to-use adapter instance.
 * To support a new gateway: implement BaseProvider and register it here.
 */
const registry = {
  [PAYMENT_METHODS.ORANGE_MONEY]: new OrangeMoneyProvider(config.providers.orange_money),
  [PAYMENT_METHODS.MYZAKA]: new MyZakaProvider(config.providers.myzaka),
  [PAYMENT_METHODS.BANK_TRANSFER]: new BankTransferProvider(config.providers.bank_transfer),
  [PAYMENT_METHODS.CARD]: new CardProvider(config.providers.card),
};

/** @returns {import('./base.provider')} */
function getProvider(method) {
  return registry[method] || null;
}

function supportedMethods() {
  return Object.keys(registry);
}

module.exports = { getProvider, supportedMethods, registry };
