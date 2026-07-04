'use strict';

const { sha256, hmac, timingSafeEqual } = require('../kernel/ids');

/**
 * Cryptographic provenance (DPI requirement #7). Every governed output is
 * wrapped in a tamper-evident envelope binding it to the events that
 * produced it, the policy decision that authorized it, the tenant, and a
 * signature. Verifiers can prove an output was produced by the platform,
 * under a specific policy decision, and has not been altered.
 *
 * HMAC here (rotation-safe via the SecretManager); production swaps the
 * signature for an asymmetric key so third parties verify without holding
 * signing material — the envelope shape is unchanged.
 */
class Provenance {
  constructor({ clock, secrets }) {
    this.clock = clock;
    this.secrets = secrets;
    this.secretName = 'provenance:signing';
    secrets.seed(this.secretName, `provenance-${sha256(String(clock.nowMs())).slice(0, 32)}`);
  }

  /** Wrap `output` with a signed provenance record. */
  sign({ output, eventRefs = [], policyDecisionId = null, tenant = 'motse', correlationId = null }) {
    const provenance = {
      tenant,
      event_refs: eventRefs,
      policy_decision_id: policyDecisionId,
      correlation_id: correlationId,
      output_hash: sha256(stableStringify(output)),
      signed_at: this.clock.nowIso(),
    };
    provenance.signature = hmac(this.secrets.current(this.secretName).value, stableStringify(provenance));
    return { output, provenance };
  }

  /** Verify an envelope: signature intact AND output unmodified. */
  verify(envelope) {
    if (!envelope || !envelope.provenance) return { valid: false, reason: 'no_provenance' };
    const { signature, ...signed } = envelope.provenance;
    if (!signature) return { valid: false, reason: 'no_signature' };
    if (sha256(stableStringify(envelope.output)) !== signed.output_hash) {
      return { valid: false, reason: 'output_tampered' };
    }
    const versions = this.secrets.validForVerification(this.secretName);
    const ok = versions.some((v) => timingSafeEqual(hmac(v.value, stableStringify(signed)), signature));
    return { valid: ok, reason: ok ? null : 'bad_signature' };
  }
}

/** Deterministic JSON with sorted keys — required for a stable signature. */
function stableStringify(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => {
      acc[k] = sortKeys(v[k]);
      return acc;
    }, {});
  }
  return v;
}

module.exports = { Provenance, stableStringify };
