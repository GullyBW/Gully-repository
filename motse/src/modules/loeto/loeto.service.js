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
    this.reviews = store.collection('booking_reviews');
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

  // ── Reviews & history (Phase 2) ────────────────────────────────────

  listExperiences() {
    return this.experiences.find((e) => e.state === 'active').map((experience) => ({
      ...experience,
      rating: this.ratingFor(experience.id),
    }));
  }

  bookingsFor(guestRef) {
    return this.bookings.find((b) => b.guest_ref === guestRef);
  }

  /** One review per settled booking, by the guest who travelled. */
  addReview(bookingId, guestRef, { rating, comment }) {
    const booking = this.get(bookingId);
    if (booking.guest_ref !== guestRef) {
      throw err('PERMISSION_DENIED', 'Only the guest reviews their booking');
    }
    if (booking.state !== 'settled') {
      throw err('STATE_CONFLICT', 'Reviews open after the experience settles');
    }
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      throw err('INVALID_ARGUMENT', 'rating must be an integer 1–5');
    }
    if (this.reviews.findOne((r) => r.booking_ref === bookingId)) {
      throw err('STATE_CONFLICT', 'This booking is already reviewed');
    }
    return this.reviews.insert({
      id: id('rvw'),
      booking_ref: bookingId,
      experience_ref: booking.experience_id,
      guest_ref: guestRef,
      rating,
      comment: comment || null,
      created_at: this.clock.nowIso(),
    });
  }

  ratingFor(experienceId) {
    const reviews = this.reviews.find((r) => r.experience_ref === experienceId);
    if (reviews.length === 0) return { count: 0, average: null };
    const total = reviews.reduce((s, r) => s + r.rating, 0);
    return { count: reviews.length, average: Math.round((total / reviews.length) * 10) / 10 };
  }
}

module.exports = { LoetoService };
