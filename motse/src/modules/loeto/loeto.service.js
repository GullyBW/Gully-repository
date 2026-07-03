'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Loeto — experiences, availability, bookings, revenue-split templates
 * (doc §3.2, §9.3).
 *
 * POST /v1/loeto/bookings creates an escrow; the split executes
 * atomically on booking.settled — guide 60 / homestead 25 / community
 * trust 10 / platform 5 is the canonical example. Each beneficiary sees
 * their line.
 */
class LoetoService {
  constructor({ store, clock, identity, ledger, escrow, bus, audit }) {
    this.experiences = store.collection('experiences');
    this.bookings = store.collection('bookings');
    this.clock = clock;
    this.identity = identity;
    this.ledger = ledger;
    this.escrow = escrow;
    this.bus = bus;
    this.audit = audit;

    bus.register('loeto.booking.settled', 1, ['booking_id', 'experience_id']);
  }

  /**
   * splitTemplate: { name, version, shares: [{ account_id, pct, label }] }
   * Validated at creation so a bad template can never take a booking.
   */
  createExperience(hostRef, { title, priceMinor, splitTemplate }) {
    this.identity.requireLevel(hostRef, 'L2'); // hosting gates on ward verification
    const totalPct = splitTemplate.shares.reduce((s, share) => s + share.pct, 0);
    if (totalPct !== 100) {
      throw err('INVALID_ARGUMENT', `Split template sums to ${totalPct}%, must be 100`);
    }
    return this.experiences.insert({
      id: id('exp'),
      host_ref: hostRef,
      title,
      price_minor: priceMinor,
      split_template: { ...splitTemplate },
      state: 'active',
      created_at: this.clock.nowIso(),
    });
  }

  /** Booking creates the escrow and takes the guest's payment into it. */
  book(experienceId, guestRef, { sourceAccountId, idempotencyKey }) {
    const experience = this.experiences.get(experienceId);
    if (!experience || experience.state !== 'active') {
      throw err('NOT_FOUND', `No active experience ${experienceId}`);
    }
    this.identity.requireLevel(guestRef, 'L1');
    const booking = this.bookings.insert({
      id: id('bkg'),
      experience_id: experienceId,
      guest_ref: guestRef,
      amount_minor: experience.price_minor,
      state: 'reserved',
      settlement_ref: null,
      created_at: this.clock.nowIso(),
    });
    const escrowRecord = this.escrow.open(`booking:${booking.id}`, experience.host_ref);
    this.escrow.fund(escrowRecord.id, {
      sourceAccountId,
      amountMinor: experience.price_minor,
      contributorRef: guestRef,
      idempotencyKey,
    });
    return this.bookings.update(booking.id, { escrow_id: escrowRecord.id, state: 'paid' });
  }

  /**
   * Settlement (experience delivered): the split executes atomically —
   * one balanced posting, every beneficiary line visible (§9.3).
   */
  settle(bookingId, actorRef, { idempotencyKey }) {
    const booking = this.bookings.get(bookingId);
    if (!booking) throw err('NOT_FOUND', `No booking ${bookingId}`);
    if (booking.state !== 'paid') throw err('STATE_CONFLICT', `Cannot settle from ${booking.state}`);
    const experience = this.experiences.get(booking.experience_id);

    // Move escrow → a settlement clearing step, then split from source.
    const escrowRecord = this.escrow.get(booking.escrow_id);
    if (escrowRecord.frozen) throw err('ESCROW_RELEASE_BLOCKED', 'Booking under dispute');

    const template = experience.split_template;
    const amounts = this.ledger.constructor.apportion(
      booking.amount_minor,
      template.shares.map((s) => s.pct)
    );
    // Single atomic posting: escrow debited, every beneficiary credited.
    const entries = [
      { account_id: escrowRecord.account_id, amount_minor: -booking.amount_minor },
      ...template.shares
        .map((share, i) => ({ account_id: share.account_id, amount_minor: amounts[i] }))
        .filter((e) => e.amount_minor > 0),
    ];
    const posting = this.ledger.post({
      entries,
      purpose: `split:${template.name}@v${template.version}`,
      ref: `booking:${bookingId}`,
      idempotencyKey,
      actorRef,
    });
    this.escrow.escrows.update(escrowRecord.id, {
      released_minor: escrowRecord.released_minor + booking.amount_minor,
    });
    const settled = this.bookings.update(bookingId, {
      state: 'settled',
      settlement_ref: posting.id,
      split_lines: template.shares.map((share, i) => ({
        label: share.label,
        account_id: share.account_id,
        pct: share.pct,
        amount_minor: amounts[i],
      })),
    });
    this.audit.append(actorRef, 'loeto.settled', `booking:${bookingId}`, null, {
      posting_id: posting.id,
    });
    this.bus.publish('loeto.booking.settled', {
      booking_id: bookingId,
      experience_id: booking.experience_id,
    });
    return settled;
  }

  /** Cancellation before settlement refunds the guest in full. */
  cancel(bookingId, actorRef, { destAccountId, idempotencyKey }) {
    const booking = this.bookings.get(bookingId);
    if (!booking) throw err('NOT_FOUND', `No booking ${bookingId}`);
    if (booking.state !== 'paid') throw err('STATE_CONFLICT', `Cannot cancel from ${booking.state}`);
    const posting = this.escrow.refund(booking.escrow_id, {
      destAccountId,
      amountMinor: booking.amount_minor,
      idempotencyKey,
      actorRef,
    });
    return this.bookings.update(bookingId, { state: 'cancelled', refund_ref: posting.id });
  }

  get(bookingId) {
    const booking = this.bookings.get(bookingId);
    if (!booking) throw err('NOT_FOUND', `No booking ${bookingId}`);
    return booking;
  }
}

module.exports = { LoetoService };
