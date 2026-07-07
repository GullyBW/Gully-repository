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
    this.relations = store.collection('family_relations');
    this.invitations = store.collection('family_invitations');
    this.events = store.collection('family_events');
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

  // ── Family tree, invitations, relationships, events (Phase 2) ─────

  /** Invite by phone number; the invitee accepts after OTP login. */
  inviteMember(circleId, inviterRef, { msisdn, relation, relatedTo }) {
    const circle = this._circle(circleId);
    if (!circle.members.includes(inviterRef)) {
      throw err('PERMISSION_DENIED', 'Only circle members invite');
    }
    const { sha256 } = require('../../kernel/ids');
    return this.invitations.insert({
      id: id('inv'),
      circle_ref: circleId,
      inviter_ref: inviterRef,
      msisdn_hash: sha256(msisdn),
      relation: relation || null,
      related_to: relatedTo || inviterRef,
      state: 'pending',
      created_at: this.clock.nowIso(),
    });
  }

  /** Accept: the logged-in user's msisdn must match the invitation. */
  acceptInvitation(invitationId, userRef) {
    const invitation = this.invitations.get(invitationId);
    if (!invitation) throw err('NOT_FOUND', `No invitation ${invitationId}`);
    if (invitation.state !== 'pending') throw err('STATE_CONFLICT', 'Invitation already handled');
    const user = this.identity.get(userRef);
    if (!user.msisdn_hash || user.msisdn_hash !== invitation.msisdn_hash) {
      throw err('PERMISSION_DENIED', 'Invitation was issued to a different phone number');
    }
    this.invitations.update(invitationId, { state: 'accepted', accepted_at: this.clock.nowIso() });
    this.addMember(invitation.circle_ref, userRef, invitation.inviter_ref);
    if (invitation.relation) {
      this.setRelation(invitation.circle_ref, invitation.inviter_ref, {
        memberRef: userRef,
        relation: invitation.relation,
        relatedTo: invitation.related_to,
      });
    }
    return this.circles.get(invitation.circle_ref);
  }

  /** Declare a relationship edge: member is <relation> of relatedTo. */
  setRelation(circleId, actorRef, { memberRef, relation, relatedTo }) {
    const circle = this._circle(circleId);
    if (!circle.members.includes(actorRef)) {
      throw err('PERMISSION_DENIED', 'Only circle members manage relationships');
    }
    if (!circle.members.includes(memberRef)) {
      throw err('INVALID_ARGUMENT', 'Both people must be circle members');
    }
    const existing = this.relations.findOne(
      (r) => r.circle_ref === circleId && r.member_ref === memberRef && r.related_to === relatedTo
    );
    if (existing) return this.relations.update(existing.id, { relation });
    return this.relations.insert({
      id: id('rel'),
      circle_ref: circleId,
      member_ref: memberRef,
      relation, // e.g. mother | son | rremogolo | nkgonne
      related_to: relatedTo,
      declared_by: actorRef,
      ts: this.clock.nowIso(),
    });
  }

  /** The family tree: members + relationship edges, members-only. */
  familyTree(circleId, viewerRef) {
    const circle = this._circle(circleId);
    if (!circle.members.includes(viewerRef)) {
      throw err('PERMISSION_DENIED', 'Family trees are visible to members only');
    }
    return {
      circle_id: circleId,
      name: circle.name,
      members: circle.members,
      relations: this.relations.find((r) => r.circle_ref === circleId),
    };
  }

  createFamilyEvent(circleId, actorRef, { title, date, kind = 'gathering' }) {
    const circle = this._circle(circleId);
    if (!circle.members.includes(actorRef)) {
      throw err('PERMISSION_DENIED', 'Only circle members create events');
    }
    return this.events.insert({
      id: id('fev'),
      circle_ref: circleId,
      title,
      date,
      kind, // gathering | wedding | funeral | naming | other
      created_by: actorRef,
      created_at: this.clock.nowIso(),
    });
  }

  familyEvents(circleId, viewerRef) {
    const circle = this._circle(circleId);
    if (!circle.members.includes(viewerRef)) {
      throw err('PERMISSION_DENIED', 'Family events are visible to members only');
    }
    return this.events.find((e) => e.circle_ref === circleId);
  }

  circlesFor(userRef) {
    return this.circles.find((c) => c.members.includes(userRef));
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
