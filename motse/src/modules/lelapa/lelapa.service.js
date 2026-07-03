'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Lelapa — family circles, voice threads, life-event ledgers, savings
 * goals (doc §3.2). Life-event ledgers are a UI over the Ledger service
 * (P3): every contribution is a real posting, so a wedding collection is
 * as auditable as a national campaign.
 */
class LelapaService {
  constructor({ store, clock, identity, ledger, escrow }) {
    this.circles = store.collection('family_circles');
    this.threads = store.collection('voice_threads');
    this.goals = store.collection('savings_goals');
    this.clock = clock;
    this.identity = identity;
    this.ledger = ledger;
    this.escrow = escrow;
  }

  // ── Circles ────────────────────────────────────────────────────────

  createCircle(ownerRef, name) {
    this.identity.requireLevel(ownerRef, 'L1'); // circles unlock at L1 (§5.1)
    return this.circles.insert({
      id: id('cir'),
      name,
      owner_ref: ownerRef,
      members: [ownerRef],
      created_at: this.clock.nowIso(),
    });
  }

  addMember(circleId, memberRef, actorRef) {
    const circle = this._circle(circleId);
    if (!circle.members.includes(actorRef)) {
      throw err('PERMISSION_DENIED', 'Only circle members invite');
    }
    if (circle.members.includes(memberRef)) return circle;
    return this.circles.update(circleId, { members: [...circle.members, memberRef] });
  }

  // ── Voice threads ──────────────────────────────────────────────────

  postVoiceNote(circleId, authorRef, mediaRef) {
    const circle = this._circle(circleId);
    if (!circle.members.includes(authorRef)) {
      throw err('PERMISSION_DENIED', 'Not a member of this circle');
    }
    return this.threads.insert({
      id: id('vth'),
      circle_ref: circleId,
      author_ref: authorRef,
      media_ref: mediaRef,
      posted_at: this.clock.nowIso(),
    });
  }

  // ── Life-event ledgers & savings goals (UI over Ledger, P3) ────────

  /** A goal is an escrow owned by the circle; contributions are postings. */
  createSavingsGoal(circleId, creatorRef, { name, targetMinor }) {
    const circle = this._circle(circleId);
    if (!circle.members.includes(creatorRef)) {
      throw err('PERMISSION_DENIED', 'Not a member of this circle');
    }
    const escrowRecord = this.escrow.open(`goal:${circleId}:${name}`, circleId);
    return this.goals.insert({
      id: id('gol'),
      circle_ref: circleId,
      name,
      target_minor: targetMinor,
      escrow_id: escrowRecord.id,
      created_at: this.clock.nowIso(),
    });
  }

  contribute(goalId, memberRef, { sourceAccountId, amountMinor, idempotencyKey }) {
    const goal = this.goals.get(goalId);
    if (!goal) throw err('NOT_FOUND', `No goal ${goalId}`);
    const circle = this._circle(goal.circle_ref);
    if (!circle.members.includes(memberRef)) {
      throw err('PERMISSION_DENIED', 'Not a member of this circle');
    }
    return this.escrow.fund(goal.escrow_id, {
      sourceAccountId,
      amountMinor,
      contributorRef: memberRef,
      idempotencyKey,
    });
  }

  /** The event ledger every member sees: real postings, per contributor. */
  goalLedger(goalId) {
    const goal = this.goals.get(goalId);
    if (!goal) throw err('NOT_FOUND', `No goal ${goalId}`);
    const escrowRecord = this.escrow.get(goal.escrow_id);
    return {
      goal_id: goalId,
      name: goal.name,
      target_minor: goal.target_minor,
      funded_minor: escrowRecord.funded_minor,
      postings: this.ledger.postingsFor(escrowRecord.ref),
    };
  }

  _circle(circleId) {
    const circle = this.circles.get(circleId);
    if (!circle) throw err('NOT_FOUND', `No circle ${circleId}`);
    return circle;
  }
}

module.exports = { LelapaService };
