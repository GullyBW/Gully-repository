'use strict';

const crypto = require('crypto');

/**
 * Secret manager abstraction (doc §13.1: "per-service secrets in Secret
 * Manager with rotation"). In-memory implementation with the production
 * contract: versioned secrets, graceful rotation (verification accepts
 * the current AND the previous version so in-flight webhooks signed
 * moments before a rotation still verify), and no secret ever logged.
 *
 * Production swaps this for GCP Secret Manager behind the same surface.
 */
class SecretManager {
  constructor(clock) {
    this.clock = clock;
    this.secrets = new Map(); // name -> [{ version, value, created_at }] newest first
  }

  /** Seed from config/env at boot. */
  seed(name, value) {
    if (this.secrets.has(name)) return this.current(name);
    return this._push(name, value);
  }

  current(name) {
    const versions = this.secrets.get(name);
    if (!versions || versions.length === 0) {
      throw new Error(`No secret named ${name}`);
    }
    return versions[0];
  }

  /**
   * Secrets valid for VERIFICATION: current + previous version.
   * Signing always uses current only.
   */
  validForVerification(name) {
    const versions = this.secrets.get(name) || [];
    return versions.slice(0, 2);
  }

  /** Rotate: mint a new version; the old one stays verify-valid. */
  rotate(name, newValue) {
    if (!this.secrets.has(name)) throw new Error(`No secret named ${name}`);
    return this._push(name, newValue);
  }

  _push(name, value) {
    const versions = this.secrets.get(name) || [];
    const entry = {
      version: versions.length + 1,
      value: value || crypto.randomBytes(32).toString('hex'),
      created_at: this.clock.nowIso(),
    };
    this.secrets.set(name, [entry, ...versions]);
    return entry;
  }

  /** Metadata only — values are never enumerable through this. */
  describe() {
    return [...this.secrets.entries()].map(([name, versions]) => ({
      name,
      versions: versions.length,
      current_version: versions[0].version,
      rotated_at: versions[0].created_at,
    }));
  }
}

module.exports = { SecretManager };
