'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Escrow engine (doc §9.2), owned by the Ledger service.
 *
 * Ledger-level invariants (business rules like dual approval live in the
 * owning module, e.g. Kgetsi):
 *   - released ≤ funded, always;
 *   - a frozen escrow blocks release but never blocks refunds
 *     ("freeze … blocks release, never blocks refund processing").
 */
class EscrowService {
  constructor({ store, clock, ledger }) {
    this.escrows = store.collection('escrows');
    this.clock = clock;
    this.ledger = ledger;
  }

  open(ref, ownerRef) {
    const account = this.ledger.openAccount(ref, 'escrow');
    return this.escrows.insert({
      id: id('esc'),
      ref,
      owner_ref: ownerRef,
      account_id: account.id,
      funded_minor: 0,
      released_minor: 0,
      refunded_minor: 0,
      frozen: false,
      created_at: this.clock.nowIso(),
    });
  }

  get(escrowId) {
    const escrow = this.escrows.get(escrowId);
    if (!escrow) throw err('NOT_FOUND', `No escrow ${escrowId}`);
    return escrow;
  }

  byRef(ref) {
    return this.escrows.findOne((e) => e.ref === ref);
  }

  /** Fund from any source account (wallet or provider clearing). */
  fund(escrowId, { sourceAccountId, amountMinor, contributorRef, idempotencyKey }) {
    const escrow = this.get(escrowId);
    const posting = this.ledger.post({
      entries: [
        { account_id: sourceAccountId, amount_minor: -amountMinor },
        { account_id: escrow.account_id, amount_minor: amountMinor },
      ],
      purpose: 'escrow_fund',
      ref: escrow.ref,
      idempotencyKey,
      actorRef: contributorRef || 'anonymous', // anonymous giving is supported (P10)
    });
    this.escrows.update(escrowId, { funded_minor: escrow.funded_minor + amountMinor });
    return posting;
  }

  /**
   * Release toward a destination. Caller (Kgetsi/Loeto) is responsible
   * for business approval; the ledger still refuses over-release and
   * frozen release unconditionally.
   */
  release(escrowId, { destAccountId, amountMinor, ref, idempotencyKey, actorRef }) {
    const escrow = this.get(escrowId);
    if (escrow.frozen) {
      throw err('ESCROW_RELEASE_BLOCKED', 'Escrow is frozen by an open dispute');
    }
    if (escrow.released_minor + amountMinor > escrow.funded_minor) {
      throw err('ESCROW_RELEASE_BLOCKED', 'released would exceed funded', {
        funded_minor: escrow.funded_minor,
        released_minor: escrow.released_minor,
      });
    }
    const posting = this.ledger.post({
      entries: [
        { account_id: escrow.account_id, amount_minor: -amountMinor },
        { account_id: destAccountId, amount_minor: amountMinor },
      ],
      purpose: 'escrow_release',
      ref: ref || escrow.ref,
      idempotencyKey,
      actorRef,
    });
    this.escrows.update(escrowId, { released_minor: escrow.released_minor + amountMinor });
    return posting;
  }

  /** Refunds process even while frozen (§9.2). */
  refund(escrowId, { destAccountId, amountMinor, ref, idempotencyKey, actorRef }) {
    const escrow = this.get(escrowId);
    const available = escrow.funded_minor - escrow.released_minor - escrow.refunded_minor;
    if (amountMinor > available) {
      throw err('STATE_CONFLICT', 'Refund exceeds remaining escrow balance', {
        available_minor: available,
      });
    }
    const posting = this.ledger.post({
      entries: [
        { account_id: escrow.account_id, amount_minor: -amountMinor },
        { account_id: destAccountId, amount_minor: amountMinor },
      ],
      purpose: 'escrow_refund',
      ref: ref || escrow.ref,
      idempotencyKey,
      actorRef,
    });
    this.escrows.update(escrowId, { refunded_minor: escrow.refunded_minor + amountMinor });
    return posting;
  }

  setFrozen(escrowId, frozen) {
    this.get(escrowId);
    return this.escrows.update(escrowId, { frozen });
  }
}

module.exports = { EscrowService };
