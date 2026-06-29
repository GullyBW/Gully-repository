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
    // 'postgres' (default) or 'mongo'. The repository layer is storage-agnostic;
    // this only selects which concrete repositories the registry builds.
    driver: process.env.DB_DRIVER || 'postgres',
    // PostgreSQL connection (default driver).
    postgresUrl:
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      'postgresql://postgres@localhost:5432/tirelo',
    // MongoDB connection (when DB_DRIVER=mongo).
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/tirelo',
  },

  payment: {
    defaultCurrency: process.env.DEFAULT_CURRENCY || 'BWP',
  },

  auth: {
    jwtSecret: process.env.JWT_SECRET || 'dev-insecure-secret-change-me',
    // Access tokens are short-lived now that refresh tokens exist; default kept
    // at 7d for backward compatibility unless ACCESS_TOKEN_TTL is set.
    jwtExpiresIn: process.env.ACCESS_TOKEN_TTL || process.env.JWT_EXPIRES_IN || '7d',
    refreshTokenTtlDays: parseInt(process.env.REFRESH_TOKEN_TTL_DAYS, 10) || 30,
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS, 10) || 10,
  },

  email: {
    // 'console' (default) logs emails; 'smtp' would use a real transport.
    transport: process.env.EMAIL_TRANSPORT || 'console',
    from: process.env.EMAIL_FROM || 'Tirelo Services <no-reply@tirelo.example.com>',
    appBaseUrl: process.env.APP_BASE_URL || 'http://localhost:8100',
  },

  redis: {
    // When unset, CacheService transparently uses an in-process LRU-ish map.
    url: process.env.REDIS_URL || '',
    defaultTtlSeconds: parseInt(process.env.CACHE_TTL_SECONDS, 10) || 60,
  },

  push: {
    // 'fcm' uses firebase-admin when configured; otherwise a console transport.
    transport: process.env.PUSH_TRANSPORT || (process.env.FCM_SERVICE_ACCOUNT ? 'fcm' : 'console'),
    fcmServiceAccount: process.env.FCM_SERVICE_ACCOUNT || '', // path or JSON
    maxRetries: parseInt(process.env.PUSH_MAX_RETRIES, 10) || 3,
  },

  storage: {
    // 'local' (default) or 's3' | 'gcs' | 'r2' | 'azure' (cloud-ready).
    driver: process.env.STORAGE_DRIVER || 'local',
    localDir: process.env.STORAGE_LOCAL_DIR || 'uploads',
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL || '', // defaults to PUBLIC_BASE_URL/uploads
    maxBytes: parseInt(process.env.UPLOAD_MAX_BYTES, 10) || 5 * 1024 * 1024,
  },

  maps: {
    // Google Maps Geocoding/Places key. When absent, the geo service falls back
    // to a built-in Botswana sandbox so the marketplace is fully usable in dev.
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY || '',
    baseUrl: process.env.GOOGLE_MAPS_BASE_URL || 'https://maps.googleapis.com/maps/api',
  },

  // Cross-cutting limits.
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 300,
  },
  uploads: {
    dir: process.env.UPLOAD_DIR || 'uploads',
    maxBytes: parseInt(process.env.UPLOAD_MAX_BYTES, 10) || 5 * 1024 * 1024, // 5MB
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
