'use strict';

require('dotenv').config();

/**
 * Centralised configuration. Reads from environment variables with sensible
 * defaults so the service can boot in development without a full .env file.
 */
const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 4000,
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://localhost:4000',

  db: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/tirelo',
  },

  payment: {
    defaultCurrency: process.env.DEFAULT_CURRENCY || 'BWP',
  },

  providers: {
    orange_money: {
      baseUrl: process.env.ORANGE_MONEY_BASE_URL,
      merchantId: process.env.ORANGE_MONEY_MERCHANT_ID,
      clientId: process.env.ORANGE_MONEY_CLIENT_ID,
      clientSecret: process.env.ORANGE_MONEY_CLIENT_SECRET,
      webhookSecret: process.env.ORANGE_MONEY_WEBHOOK_SECRET || 'changeme',
    },
    myzaka: {
      baseUrl: process.env.MYZAKA_BASE_URL,
      merchantId: process.env.MYZAKA_MERCHANT_ID,
      apiKey: process.env.MYZAKA_API_KEY,
      webhookSecret: process.env.MYZAKA_WEBHOOK_SECRET || 'changeme',
    },
    bank_transfer: {
      bankName: process.env.BANK_NAME || 'First National Bank Botswana',
      accountName: process.env.BANK_ACCOUNT_NAME || 'Tirelo Services (Pty) Ltd',
      accountNumber: process.env.BANK_ACCOUNT_NUMBER || '00000000000',
      branchCode: process.env.BANK_BRANCH_CODE || '000000',
    },
    card: {
      baseUrl: process.env.CARD_GATEWAY_BASE_URL,
      publicKey: process.env.CARD_GATEWAY_PUBLIC_KEY,
      secretKey: process.env.CARD_GATEWAY_SECRET_KEY,
      webhookSecret: process.env.CARD_GATEWAY_WEBHOOK_SECRET || 'changeme',
      returnUrl: process.env.CARD_GATEWAY_RETURN_URL || 'http://localhost:4000/payment/complete',
    },
  },
};

module.exports = config;
