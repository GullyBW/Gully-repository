'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Fraud detection hooks (doc §13.2). The engine is a pipeline of
 * pluggable checks run before money-moving operations. Checks return
 * flags with an action:
 *   - 'deny'   → the operation is blocked (PERMISSION_DENIED);
 *   - 'review' → the operation proceeds but is queued for manual review;
 *   - 'note'   → recorded only.
 *
 * Built-in checks: payment velocity per actor, large-amount review,
 * SIM-swap heuristic hook (payout after a fresh device change, §13.2
 * "SIM-swap heuristics before payout changes").
 */
class FraudEngine {
  constructor({ store, clock }) {
    this.clock = clock;
    this.events = store.collection('fraud_events');
    this.reviews = store.collection('fraud_reviews');
    this.checks = new Map();
    this._history = []; // { actorRef, kind, amountMinor, at }

    this.register('velocity', (ctx, engine) => {
      if (!ctx.actorRef) return null;
      const windowStart = engine.clock.nowMs() - 10 * 60 * 1000;
      const recent = engine._history.filter(
        (h) => h.actorRef === ctx.actorRef && h.at >= windowStart
      );
      if (recent.length >= 10) return { action: 'deny', detail: `${recent.length} operations in 10m` };
      if (recent.length >= 5) return { action: 'review', detail: `${recent.length} operations in 10m` };
      return null;
    });

    this.register('large_amount', (ctx) => {
      if (ctx.amountMinor >= 500000) {
        // BWP 5,000+ — proceeds, but a human looks at it.
        return { action: 'review', detail: `amount ${ctx.amountMinor} over review threshold` };
      }
      return null;
    });

    this.register('sim_swap_heuristic', (ctx, engine) => {
      if (ctx.kind !== 'payout' || !ctx.deviceAgeMs) return null;
      if (ctx.deviceAgeMs < 24 * 3600 * 1000) {
        return { action: 'review', detail: 'payout from a device registered <24h ago' };
      }
      return null;
    });
  }

  /** Extension point: register a custom check. */
  register(name, fn) {
    this.checks.set(name, fn);
  }

  /**
   * Run all checks. Throws PERMISSION_DENIED if any check denies;
   * records review flags and returns them otherwise.
   */
  assess(ctx) {
    const flags = [];
    for (const [name, check] of this.checks) {
      const result = check(ctx, this);
      if (result) flags.push({ check: name, ...result });
    }
    this._history.push({
      actorRef: ctx.actorRef,
      kind: ctx.kind,
      amountMinor: ctx.amountMinor,
      at: this.clock.nowMs(),
    });
    const record = {
      id: id('frd'),
      kind: ctx.kind,
      actor_ref: ctx.actorRef || null,
      amount_minor: ctx.amountMinor || null,
      flags,
      ts: this.clock.nowIso(),
    };
    if (flags.length > 0) this.events.insert(record);
    const denied = flags.filter((f) => f.action === 'deny');
    if (denied.length > 0) {
      throw err('PERMISSION_DENIED', 'Blocked by fraud checks', { fraud_flags: denied });
    }
    for (const flag of flags.filter((f) => f.action === 'review')) {
      this.reviews.insert({
        id: id('frw'),
        fraud_event_id: record.id,
        check: flag.check,
        detail: flag.detail,
        subject_ref: ctx.subjectRef || null,
        state: 'open',
        ts: this.clock.nowIso(),
      });
    }
    return flags;
  }

  openReviews() {
    return this.reviews.find((r) => r.state === 'open');
  }

  closeReview(reviewId, resolution, actor) {
    const review = this.reviews.get(reviewId);
    if (!review) throw err('NOT_FOUND', `No review ${reviewId}`);
    return this.reviews.update(reviewId, {
      state: 'closed',
      resolution,
      closed_by: actor,
      closed_at: this.clock.nowIso(),
    });
  }
}

module.exports = { FraudEngine };
