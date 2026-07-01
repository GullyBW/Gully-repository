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

  // ---- Day-trading subsystem (see docs/TRADING.md) ----
  // Everything defaults to a safe, fully-offline paper-trading sandbox so the
  // engine boots and is testable without an Interactive Brokers connection.
  trading: {
    // 'simulated' (default, offline) or 'ibkr' (Interactive Brokers Client
    // Portal Web API). The market-data layer is provider-agnostic; this only
    // selects which adapter the registry builds.
    dataProvider: process.env.TRADING_DATA_PROVIDER || 'simulated',

    // 'paper' (default) simulates fills locally. 'live' is required *in
    // addition to* liveOrdersEnabled below before a real order can ever leave
    // this process — two independent switches, both off by default.
    runMode: process.env.TRADING_RUN_MODE || 'paper',
    liveOrdersEnabled: process.env.TRADING_LIVE_ORDERS_ENABLED === 'true',

    baseCurrency: process.env.TRADING_BASE_CURRENCY || 'USD',
    // Symbols the engine watches when none are supplied explicitly.
    watchlist: (process.env.TRADING_WATCHLIST || 'AAPL,MSFT,NVDA,TSLA,AMZN,SPY')
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean),

    // Interactive Brokers Client Portal Gateway. Run the gateway locally and
    // authenticate once; the adapter then talks to it over HTTPS.
    ibkr: {
      baseUrl: process.env.IBKR_GATEWAY_URL || 'https://localhost:5000/v1/api',
      accountId: process.env.IBKR_ACCOUNT_ID || '',
      // The self-signed gateway cert means TLS verification is usually off for
      // localhost; leave true when pointing at a trusted proxy.
      rejectUnauthorized: process.env.IBKR_TLS_REJECT_UNAUTHORIZED === 'true',
      timeoutMs: parseInt(process.env.IBKR_TIMEOUT_MS, 10) || 8000,
    },

    // Risk limits applied to every sizing decision (see risk/riskManager.js).
    risk: {
      startingEquity: parseFloat(process.env.TRADING_STARTING_EQUITY) || 100000,
      riskPerTradePct: parseFloat(process.env.TRADING_RISK_PER_TRADE_PCT) || 0.01, // 1% of equity
      maxPositionPct: parseFloat(process.env.TRADING_MAX_POSITION_PCT) || 0.2, // 20% notional cap
      maxPortfolioExposurePct: parseFloat(process.env.TRADING_MAX_EXPOSURE_PCT) || 1.0,
      maxOpenPositions: parseInt(process.env.TRADING_MAX_OPEN_POSITIONS, 10) || 8,
      maxDailyLossPct: parseFloat(process.env.TRADING_MAX_DAILY_LOSS_PCT) || 0.03, // 3% kill-switch
      targetAnnualVolPct: parseFloat(process.env.TRADING_TARGET_VOL_PCT) || 0.15,
      kellyFraction: parseFloat(process.env.TRADING_KELLY_FRACTION) || 0.5, // half-Kelly
      atrStopMultiple: parseFloat(process.env.TRADING_ATR_STOP_MULT) || 2.0,
      atrTargetMultiple: parseFloat(process.env.TRADING_ATR_TARGET_MULT) || 3.0,
    },

    // Relative weights the ensemble gives each strategy's vote.
    strategyWeights: {
      momentum: parseFloat(process.env.TRADING_W_MOMENTUM) || 1.0,
      mean_reversion: parseFloat(process.env.TRADING_W_MEANREV) || 0.8,
      breakout: parseFloat(process.env.TRADING_W_BREAKOUT) || 1.0,
      news_sentiment: parseFloat(process.env.TRADING_W_NEWS) || 1.2,
    },
  },
};

module.exports = config;
