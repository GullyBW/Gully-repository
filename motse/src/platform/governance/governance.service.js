'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Governance engine (doc §10): councils, custodian seats, elder
 * elections, dispute rings, seat freezes.
 *
 * Seats are roles: a custodian(morafe:X) grant exists only through a
 * seat record. Ring 3 (succession freeze) is a data state — freezing a
 * bogosi seat suspends its grants automatically; the system holds no
 * opinion about who the rightful kgosi is.
 */
const SEAT_KINDS = ['bogosi', 'association', 'elected'];

class GovernanceService {
  constructor({ store, clock, identity, audit, bus }) {
    this.councils = store.collection('councils');
    this.seats = store.collection('council_seats');
    this.elections = store.collection('elder_elections');
    this.disputes = store.collection('disputes');
    this.clock = clock;
    this.identity = identity;
    this.audit = audit;
    this.bus = bus;

    bus.register('governance.seat.frozen', 1, ['seat_id', 'morafe_ref']);
    bus.register('governance.dispute.opened', 1, ['dispute_id', 'object_ref', 'ring']);
    bus.register('governance.dispute.resolved', 1, ['dispute_id', 'object_ref']);
  }

  // ── Councils & seats (§10.2) ───────────────────────────────────────

  createCouncil(morafeRef, createdBy) {
    return this.councils.insert({
      id: id('cnl'),
      morafe_ref: morafeRef,
      created_by: createdBy,
      created_at: this.clock.nowIso(),
    });
  }

  grantSeat(councilId, { kind, holderRef, termStart, termEnd }, grantedBy) {
    if (!SEAT_KINDS.includes(kind)) throw err('INVALID_ARGUMENT', `Unknown seat kind ${kind}`);
    const council = this.councils.get(councilId);
    if (!council) throw err('NOT_FOUND', `No council ${councilId}`);
    const seat = this.seats.insert({
      id: id('seat'),
      council_id: councilId,
      morafe_ref: council.morafe_ref,
      kind,
      holder_ref: holderRef,
      term_start: termStart,
      term_end: termEnd,
      state: 'active',
    });
    // The seat is what carries the custodian role (§10.2 "seats as roles").
    this.identity.grantRole(holderRef, 'custodian', `morafe:${council.morafe_ref}`, grantedBy);
    this.audit.append(grantedBy, 'governance.seat_granted', `seat:${seat.id}`, null, {
      kind,
      holder_ref: holderRef,
      morafe_ref: council.morafe_ref,
    });
    return seat;
  }

  /** Ring 3: succession freeze — grants suspend automatically. */
  freezeSeat(seatId, reason, actor) {
    const seat = this.seats.get(seatId);
    if (!seat) throw err('NOT_FOUND', `No seat ${seatId}`);
    this.seats.update(seatId, { state: 'frozen', freeze_reason: reason });
    this.identity.setScopeSuspended('custodian', `morafe:${seat.morafe_ref}`, true, actor);
    this.audit.append(actor, 'governance.seat_frozen', `seat:${seatId}`, { state: seat.state }, {
      state: 'frozen',
      reason,
    });
    this.bus.publish('governance.seat.frozen', { seat_id: seatId, morafe_ref: seat.morafe_ref });
    return this.seats.get(seatId);
  }

  unfreezeSeat(seatId, actor) {
    const seat = this.seats.get(seatId);
    if (!seat) throw err('NOT_FOUND', `No seat ${seatId}`);
    this.seats.update(seatId, { state: 'active', freeze_reason: null });
    this.identity.setScopeSuspended('custodian', `morafe:${seat.morafe_ref}`, false, actor);
    this.audit.append(actor, 'governance.seat_unfrozen', `seat:${seatId}`, null, { state: 'active' });
    return this.seats.get(seatId);
  }

  // ── Elder elections (§10.2) ────────────────────────────────────────

  openElection(councilId, seatDescription, openedBy) {
    const council = this.councils.get(councilId);
    if (!council) throw err('NOT_FOUND', `No council ${councilId}`);
    return this.elections.insert({
      id: id('ele'),
      council_id: councilId,
      morafe_ref: council.morafe_ref,
      seat_description: seatDescription,
      state: 'open',
      candidates: [],
      votes: {}, // voterRef -> candidateRef; one-member-one-vote
      opened_by: openedBy,
      opened_at: this.clock.nowIso(),
    });
  }

  nominate(electionId, candidateRef) {
    const election = this._openElection(electionId);
    if (!election.candidates.includes(candidateRef)) {
      this.elections.update(electionId, { candidates: [...election.candidates, candidateRef] });
    }
    return this.elections.get(electionId);
  }

  /** Voting: L2 members of the morafe, one member one vote. */
  vote(electionId, voterRef, candidateRef) {
    const election = this._openElection(electionId);
    this.identity.requireLevel(voterRef, 'L2');
    if (!this.identity.attestMembership(voterRef, election.morafe_ref)) {
      throw err('MEMBERSHIP_REQUIRED', 'Only morafe members vote in elder elections');
    }
    if (!election.candidates.includes(candidateRef)) {
      throw err('INVALID_ARGUMENT', 'Not a nominated candidate');
    }
    // Last vote wins for the same voter — still one-member-one-vote.
    this.elections.update(electionId, { votes: { ...election.votes, [voterRef]: candidateRef } });
    return this.elections.get(electionId);
  }

  /** Close with published turnout (§10.2). */
  closeElection(electionId, closedBy, eligibleCount) {
    const election = this._openElection(electionId);
    const tally = {};
    for (const candidate of Object.values(election.votes)) {
      tally[candidate] = (tally[candidate] || 0) + 1;
    }
    const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0] || [null, 0];
    const closed = this.elections.update(electionId, {
      state: 'closed',
      tally,
      winner_ref: winner[0],
      turnout: {
        votes_cast: Object.keys(election.votes).length,
        eligible: eligibleCount,
      },
      closed_at: this.clock.nowIso(),
    });
    this.audit.append(closedBy, 'governance.election_closed', `election:${electionId}`, null, {
      winner_ref: closed.winner_ref,
      turnout: closed.turnout,
    });
    return closed;
  }

  _openElection(electionId) {
    const election = this.elections.get(electionId);
    if (!election) throw err('NOT_FOUND', `No election ${electionId}`);
    if (election.state !== 'open') throw err('STATE_CONFLICT', 'Election is closed');
    return election;
  }

  // ── Dispute rings (§10.1) ──────────────────────────────────────────
  // contested → ring1(council, 30d SLA) → ring2(panel) → resolved(plural)

  openDispute(objectRef, raisedBy, summary) {
    const dispute = this.disputes.insert({
      id: id('dsp'),
      object_ref: objectRef,
      raised_by: raisedBy,
      summary,
      ring: 1,
      state: 'open',
      sla_deadline: new Date(this.clock.nowMs() + 30 * 24 * 3600 * 1000).toISOString(),
      opened_at: this.clock.nowIso(),
    });
    this.audit.append(raisedBy, 'governance.dispute_opened', objectRef, null, {
      dispute_id: dispute.id,
      ring: 1,
    });
    this.bus.publish('governance.dispute.opened', {
      dispute_id: dispute.id,
      object_ref: objectRef,
      ring: 1,
    });
    return dispute;
  }

  escalateDispute(disputeId, actor) {
    const dispute = this._openDispute(disputeId);
    if (dispute.ring >= 2) throw err('STATE_CONFLICT', 'Already at Ring 2 (panel)');
    const updated = this.disputes.update(disputeId, { ring: 2 });
    this.audit.append(actor, 'governance.dispute_escalated', dispute.object_ref, { ring: 1 }, { ring: 2 });
    return updated;
  }

  /** Plural resolution: outcome text, not a single winner (§10.1). */
  resolveDispute(disputeId, resolution, resolvedBy) {
    const dispute = this._openDispute(disputeId);
    const updated = this.disputes.update(disputeId, {
      state: 'resolved',
      resolution,
      resolved_by: resolvedBy,
      resolved_at: this.clock.nowIso(),
    });
    this.audit.append(resolvedBy, 'governance.dispute_resolved', dispute.object_ref, null, {
      dispute_id: disputeId,
      resolution,
    });
    this.bus.publish('governance.dispute.resolved', {
      dispute_id: disputeId,
      object_ref: dispute.object_ref,
    });
    return updated;
  }

  hasOpenDispute(objectRef) {
    return !!this.disputes.findOne((d) => d.object_ref === objectRef && d.state === 'open');
  }

  _openDispute(disputeId) {
    const dispute = this.disputes.get(disputeId);
    if (!dispute) throw err('NOT_FOUND', `No dispute ${disputeId}`);
    if (dispute.state !== 'open') throw err('STATE_CONFLICT', 'Dispute already resolved');
    return dispute;
  }
}

module.exports = { GovernanceService, SEAT_KINDS };
