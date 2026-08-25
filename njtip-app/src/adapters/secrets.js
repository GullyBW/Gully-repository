'use strict';
// Secrets PORT (HashiCorp Vault / cloud KMS / HSM shaped). The app reads secrets through
// get(name) and never from files or hard-coded values. Reference implementation sources
// secrets from validated config/env with LEASES (TTL) and versioned ROTATION; production
// drivers (Vault, AWS/GCP/Azure KMS secret stores, HSM-backed) implement the SAME port
// (docs/production-adapters.md). Secret VALUES are never logged (config.redacted covers
// dumps); this port additionally exposes only metadata, never the value, in list()/status().
//
// 🔒 Root key material / HSM custody remains human-managed. This adapter manages the
// operational lifecycle (lease, rotate, version) around secrets the platform consumes.
class SecretsManager {
  constructor({ clock = () => Date.now(), leaseMs = 3600_000, source = {} } = {}) {
    this._clock = clock; this._leaseMs = leaseMs;
    this._secrets = new Map(); // name -> { versions: [{version, value, createdAt}], current }
    for (const [name, value] of Object.entries(source)) if (value !== undefined) this._set(name, value);
  }
  _set(name, value) {
    const rec = this._secrets.get(name) || { versions: [], current: 0 };
    rec.current += 1;
    rec.versions.push({ version: rec.current, value, createdAt: this._clock() });
    this._secrets.set(name, rec);
    return rec.current;
  }
  // Read a secret, issuing a lease. The value is returned to the caller but never stored
  // anywhere loggable; the lease bounds how long a cached copy should be trusted.
  get(name) {
    const rec = this._secrets.get(name); if (!rec) return null;
    const v = rec.versions[rec.versions.length - 1];
    return { value: v.value, version: v.version, lease: { expiresAt: this._clock() + this._leaseMs, ttlMs: this._leaseMs } };
  }
  set(name, value) { return this._set(name, value); }
  rotate(name, newValue) { if (!this._secrets.has(name)) return null; return this._set(name, newValue); }
  // Metadata only — NEVER the value (safe for admin/status surfaces).
  status(name) { const rec = this._secrets.get(name); return rec ? { name, currentVersion: rec.current, versions: rec.versions.length } : null; }
  list() { return [...this._secrets.keys()].map((name) => this.status(name)); }
}

function makeSecretsManager(cfg = {}) {
  if (cfg.secrets && cfg.secrets !== 'env') {
    throw new Error(`secrets driver '${cfg.secrets}' is a documented drop-in (Vault/KMS/HSM); not bundled in-repo (docs/production-adapters.md)`);
  }
  // Reference source: the secrets the platform consumes, from validated config.
  return new SecretsManager({ clock: cfg.clock, source: { SESSION_SECRET: cfg.SESSION_SECRET, OIDC_SECRET: cfg.OIDC_SECRET, DB_PASSWORD: cfg.DB_PASSWORD } });
}

module.exports = { SecretsManager, makeSecretsManager };
