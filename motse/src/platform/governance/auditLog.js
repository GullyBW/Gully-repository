'use strict';

const { id, sha256 } = require('../../kernel/ids');

/**
 * Append-only, hash-chained audit log (doc §10.2, P10).
 *
 * Every privileged action produces an immutable AuditEvent. Events are
 * hash-chained per object, so the public can verify that a displayed log
 * is complete (inclusion proofs) — transparency as a testable claim, not
 * a UI feature.
 */
class AuditLog {
  constructor(store, clock) {
    this.events = store.collection('audit_events');
    this.clock = clock;
    this.heads = new Map(); // objectRef -> hash of last entry in that chain
  }

  /**
   * @param {string} actorRef  who acted
   * @param {string} action    e.g. heritage.validate, ledger.release
   * @param {string} objectRef the object the chain belongs to
   * @param {object} [before]  digested into the entry
   * @param {object} [after]
   */
  append(actorRef, action, objectRef, before = null, after = null) {
    const prevHash = this.heads.get(objectRef) || 'genesis';
    const entry = {
      id: id('aud'),
      actor_ref: actorRef,
      action,
      object_ref: objectRef,
      before_digest: before ? sha256(JSON.stringify(before)) : null,
      after_digest: after ? sha256(JSON.stringify(after)) : null,
      ts: this.clock.nowIso(),
      prev_hash: prevHash,
    };
    entry.hash = sha256(
      entry.prev_hash +
        entry.actor_ref +
        entry.action +
        entry.object_ref +
        (entry.before_digest || '') +
        (entry.after_digest || '') +
        entry.ts
    );
    this.heads.set(objectRef, entry.hash);
    this.events.insert(entry);
    return entry;
  }

  /** All events for an object, in chain order. */
  chainFor(objectRef) {
    return this.events.find((e) => e.object_ref === objectRef);
  }

  /**
   * Verify a chain end-to-end. Returns { valid, length }. A tampered,
   * reordered, or truncated-in-the-middle log fails.
   */
  verifyChain(objectRef) {
    const chain = this.chainFor(objectRef);
    let prev = 'genesis';
    for (const entry of chain) {
      if (entry.prev_hash !== prev) return { valid: false, length: chain.length };
      const recomputed = sha256(
        entry.prev_hash +
          entry.actor_ref +
          entry.action +
          entry.object_ref +
          (entry.before_digest || '') +
          (entry.after_digest || '') +
          entry.ts
      );
      if (recomputed !== entry.hash) return { valid: false, length: chain.length };
      prev = entry.hash;
    }
    return { valid: true, length: chain.length };
  }

  /**
   * Inclusion proof: the minimal material a third party needs to check
   * that `entryId` is part of the object's chain and that the chain up
   * to the current head is unbroken.
   */
  inclusionProof(objectRef, entryId) {
    const chain = this.chainFor(objectRef);
    const index = chain.findIndex((e) => e.id === entryId);
    if (index === -1) return null;
    return {
      entry: chain[index],
      successors: chain.slice(index + 1).map((e) => ({
        hash: e.hash,
        prev_hash: e.prev_hash,
        actor_ref: e.actor_ref,
        action: e.action,
        object_ref: e.object_ref,
        before_digest: e.before_digest,
        after_digest: e.after_digest,
        ts: e.ts,
      })),
      head: this.heads.get(objectRef),
    };
  }

  /** Third-party verification of an inclusion proof (pure function). */
  static verifyInclusion(proof) {
    if (!proof || !proof.entry) return false;
    const recompute = (e) =>
      sha256(
        e.prev_hash +
          e.actor_ref +
          e.action +
          e.object_ref +
          (e.before_digest || '') +
          (e.after_digest || '') +
          e.ts
      );
    if (recompute(proof.entry) !== proof.entry.hash) return false;
    let prev = proof.entry.hash;
    for (const succ of proof.successors) {
      if (succ.prev_hash !== prev) return false;
      if (recompute(succ) !== succ.hash) return false;
      prev = succ.hash;
    }
    return prev === proof.head;
  }
}

module.exports = { AuditLog };
