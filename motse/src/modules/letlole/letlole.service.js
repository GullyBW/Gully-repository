'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Letlole — trust registers, resolutions, AGM machinery, distributions
 * (doc §3.2, §7.2). A regulated entity boundary: trust treasuries are
 * ledger accounts, resolutions are e-signed by trustees and appended to
 * the hash-chained audit log, and treasuries may opt in to the public
 * transparency API (§7.3).
 */
class LetloleService {
  constructor({ store, clock, identity, ledger, audit }) {
    this.trusts = store.collection('trusts');
    this.resolutions = store.collection('trust_resolutions');
    this.clock = clock;
    this.identity = identity;
    this.ledger = ledger;
    this.audit = audit;
  }

  registerTrust(registrarRef, { name, deedDocRef, trustees, beneficiaries }) {
    this.identity.requireLevel(registrarRef, 'L3'); // trust administration is L3
    if (!Array.isArray(trustees) || trustees.length < 2) {
      throw err('INVALID_ARGUMENT', 'A trust requires at least two trustees');
    }
    const account = this.ledger.openAccount(`trust:${name}`, 'trust');
    const trust = this.trusts.insert({
      id: id('tst'),
      name,
      deed_doc_ref: deedDocRef,
      trustees,
      beneficiaries: beneficiaries || [],
      assets: [],
      treasury_account_id: account.id,
      public_treasury: false,
      created_at: this.clock.nowIso(),
    });
    for (const trustee of trustees) {
      this.identity.grantRole(trustee, 'trustee', `trust:${trust.id}`, registrarRef);
    }
    this.audit.append(registrarRef, 'letlole.trust_registered', `trust:${trust.id}`, null, { name });
    return trust;
  }

  /** Draft a resolution; it takes effect only once quorum has signed. */
  proposeResolution(trustId, proposerRef, { title, body, kind = 'general', distribution }) {
    const trust = this._trust(trustId);
    this.identity.requireRole(proposerRef, 'trustee', `trust:${trustId}`);
    return this.resolutions.insert({
      id: id('res'),
      trust_ref: trustId,
      title,
      body,
      kind, // general | distribution
      distribution: distribution || null, // { dest_account_id, amount_minor }
      signatures: [],
      quorum: Math.floor(trust.trustees.length / 2) + 1,
      state: 'proposed',
      proposed_by: proposerRef,
      created_at: this.clock.nowIso(),
    });
  }

  /**
   * POST /v1/trusts/{id}/resolutions/{r}:sign — trustee e-sign, appended
   * to the audit log. Privileged: re-authentication is required at the
   * API layer (§5.3).
   */
  signResolution(trustId, resolutionId, trusteeRef, { idempotencyKey } = {}) {
    this._trust(trustId);
    this.identity.requireRole(trusteeRef, 'trustee', `trust:${trustId}`);
    const resolution = this._resolution(resolutionId);
    if (resolution.state !== 'proposed') throw err('STATE_CONFLICT', `Resolution is ${resolution.state}`);
    if (resolution.signatures.some((s) => s.trustee_ref === trusteeRef)) {
      return resolution; // idempotent signature
    }
    const signatures = [
      ...resolution.signatures,
      { trustee_ref: trusteeRef, ts: this.clock.nowIso() },
    ];
    let updated = this.resolutions.update(resolutionId, { signatures });
    this.audit.append(trusteeRef, 'letlole.resolution_signed', `resolution:${resolutionId}`, null, {
      signatures: signatures.length,
      quorum: resolution.quorum,
    });
    if (signatures.length >= resolution.quorum) {
      updated = this._execute(trustId, resolutionId, { idempotencyKey });
    }
    return updated;
  }

  _execute(trustId, resolutionId, { idempotencyKey }) {
    const trust = this._trust(trustId);
    const resolution = this._resolution(resolutionId);
    let executionRef = null;
    if (resolution.kind === 'distribution' && resolution.distribution) {
      const posting = this.ledger.transfer({
        source: trust.treasury_account_id,
        dest: resolution.distribution.dest_account_id,
        amountMinor: resolution.distribution.amount_minor,
        purpose: 'trust_distribution',
        ref: `resolution:${resolutionId}`,
        idempotencyKey: idempotencyKey || `resolution:${resolutionId}`,
        actorRef: `trust:${trustId}`,
      });
      executionRef = posting.id;
    }
    const executed = this.resolutions.update(resolutionId, {
      state: 'executed',
      executed_at: this.clock.nowIso(),
      execution_ref: executionRef,
    });
    this.audit.append(`trust:${trustId}`, 'letlole.resolution_executed', `resolution:${resolutionId}`,
      null, { execution_ref: executionRef });
    return executed;
  }

  setTreasuryPublic(trustId, trusteeRef, isPublic) {
    this._trust(trustId);
    this.identity.requireRole(trusteeRef, 'trustee', `trust:${trustId}`);
    return this.trusts.update(trustId, { public_treasury: isPublic });
  }

  /** Public transparency API (§7.3) — only where the trust opted in. */
  publicTreasury(trustId) {
    const trust = this._trust(trustId);
    if (!trust.public_treasury) throw err('PERMISSION_DENIED', 'Treasury not public');
    return {
      trust_id: trustId,
      name: trust.name,
      balance_minor: this.ledger.balance(trust.treasury_account_id),
      resolutions: this.resolutions
        .find((r) => r.trust_ref === trustId && r.state === 'executed')
        .map((r) => ({ id: r.id, title: r.title, kind: r.kind, executed_at: r.executed_at })),
    };
  }

  _trust(trustId) {
    const trust = this.trusts.get(trustId);
    if (!trust) throw err('NOT_FOUND', `No trust ${trustId}`);
    return trust;
  }

  _resolution(resolutionId) {
    const resolution = this.resolutions.get(resolutionId);
    if (!resolution) throw err('NOT_FOUND', `No resolution ${resolutionId}`);
    return resolution;
  }
}

module.exports = { LetloleService };
