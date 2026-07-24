'use strict';
// Configuration & secrets management (12-factor). Values come from the environment
// with validated defaults. Secrets are redacted in any dump. No secret is ever logged
// or committed. Selecting adapters here is how PRODUCTION components replace SYNTHETIC
// ones without touching business logic (composition root, src/app.js).
const REDACT = new Set(['SESSION_SECRET', 'KMS_KEY', 'DB_PASSWORD']);

function load(env = process.env) {
  const cfg = {
    mode: env.NJTIP_MODE || 'synthetic', // synthetic | production-shaped
    persistence: env.NJTIP_PERSISTENCE || 'memory', // memory | file
    dataDir: env.NJTIP_DATA_DIR || require('node:path').join(__dirname, '..', 'data'),
    port: Number(env.PORT || 8087),
    logLevel: env.NJTIP_LOG_LEVEL || 'info',
    // Secret: session signing key. In production this comes from a secrets manager;
    // here a synthetic default is used and clearly labelled.
    SESSION_SECRET: env.NJTIP_SESSION_SECRET || 'SYNTHETIC-SESSION-SIGNING-KEY-do-not-use-in-prod',
    sessionTtlMs: Number(env.NJTIP_SESSION_TTL_MS || 3600_000),
    version: '1.1.0',
  };
  validate(cfg);
  return cfg;
}

function validate(cfg) {
  if (!['memory', 'file'].includes(cfg.persistence)) throw new Error(`invalid NJTIP_PERSISTENCE: ${cfg.persistence}`);
  if (!['synthetic', 'production-shaped'].includes(cfg.mode)) throw new Error(`invalid NJTIP_MODE: ${cfg.mode}`);
  if (!Number.isInteger(cfg.port) || cfg.port < 0) throw new Error('invalid PORT');
}

// Redacted view safe to expose on an admin endpoint or in logs.
function redacted(cfg) {
  const out = {};
  for (const [k, v] of Object.entries(cfg)) out[k] = REDACT.has(k) ? '***REDACTED***' : v;
  return out;
}

module.exports = { load, redacted, REDACT };
