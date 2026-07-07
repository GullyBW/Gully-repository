'use strict';

const { AuditLog } = require('../src/platform/governance/auditLog');
const { world, freshVerifiedUser, publishedItem } = require('./helpers');

describe('Identity levels & RBAC (§5)', () => {
  test('one identity accrues levels: L0 → L1 → L2 (P2)', () => {
    const w = world();
    const anon = w.p.identity.registerAnonymous('device-9');
    expect(anon.level).toBe('L0');
    const { sandbox_code } = w.p.identity.requestOtp('+26771222333');
    const { user } = w.p.identity.verifyOtp('+26771222333', sandbox_code, {
      deviceId: 'device-9',
      userId: anon.id,
    });
    expect(user.id).toBe(anon.id); // same account, more privileges
    expect(user.level).toBe('L1');
    const endorsed = w.p.identity.endorseWardResidency(user.id, w.ward.id, w.headman.id);
    expect(endorsed.level).toBe('L2');
  });

  test('level gates throw AUTH_LEVEL_REQUIRED with the required level in the payload', () => {
    const w = world();
    expect(() => w.p.kgotla.createListing(w.kabo.id, { title: 'goat', priceMinor: 1 })).toThrow(
      expect.objectContaining({ code: 'AUTH_LEVEL_REQUIRED', payload: { required_level: 'L2' } })
    );
  });

  test('random endorsers cannot mint L2 — only the ward verification circle', () => {
    const w = world();
    const rando = freshVerifiedUser(w.p);
    const target = freshVerifiedUser(w.p);
    expect(() => w.p.identity.endorseWardResidency(target.id, w.ward.id, rando.id)).toThrow(
      expect.objectContaining({ code: 'AUTH_LEVEL_REQUIRED' })
    );
  });

  test('access tokens are device-bound and refresh tokens rotate (§5.3)', () => {
    const w = world();
    const { sandbox_code } = w.p.identity.requestOtp('+26771444555');
    const { session } = w.p.identity.verifyOtp('+26771444555', sandbox_code, {
      deviceId: 'phone-A',
    });
    expect(() =>
      w.p.identity.verifyAccess(session.access_token, { deviceId: 'phone-B' })
    ).toThrow(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    const refreshed = w.p.identity.refreshSession(session.refresh_token);
    expect(refreshed.refresh_token).not.toBe(session.refresh_token);
    expect(() => w.p.identity.refreshSession(session.refresh_token)).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' })
    );
  });
});

describe('Governance engine (§10)', () => {
  test('Ring 3: freezing a bogosi seat suspends custodian powers as a data state', () => {
    const w = world();
    const council = w.p.governance.createCouncil('bakalanga', w.admin.id);
    const kgosi = freshVerifiedUser(w.p);
    const seat = w.p.governance.grantSeat(
      council.id,
      { kind: 'bogosi', holderRef: kgosi.id },
      w.admin.id
    );
    const item = publishedItem(w);
    // Custodian action works while the seat is active.
    w.p.heritage.validate(item.id, kgosi.id, { decision: 'annotate', note: 'ke nnete' });

    w.p.governance.freezeSeat(seat.id, 'succession contested', w.admin.id);
    expect(() =>
      w.p.heritage.validate(item.id, kgosi.id, { decision: 'elevate' })
    ).toThrow(expect.objectContaining({ code: 'SEAT_FROZEN' }));

    w.p.governance.unfreezeSeat(seat.id, w.admin.id);
    expect(w.p.heritage.validate(item.id, kgosi.id, { decision: 'elevate' }).state).toBe(
      'validated'
    );
  });

  test('elder elections: L2 morafe members only, one member one vote, published turnout', () => {
    const w = world();
    const council = w.p.governance.createCouncil('bakalanga', w.admin.id);
    const election = w.p.governance.openElection(council.id, 'elder seat 1', w.admin.id);
    const candidate = freshVerifiedUser(w.p);
    w.p.governance.nominate(election.id, candidate.id);

    // kabo is only L1 — not eligible.
    expect(() => w.p.governance.vote(election.id, w.kabo.id, candidate.id)).toThrow(
      expect.objectContaining({ code: 'AUTH_LEVEL_REQUIRED' })
    );
    // mma is L2 + member: votes, and re-voting does not double-count.
    w.p.governance.vote(election.id, w.mma.id, candidate.id);
    w.p.governance.vote(election.id, w.mma.id, candidate.id);
    const closed = w.p.governance.closeElection(election.id, w.admin.id, 40);
    expect(closed.winner_ref).toBe(candidate.id);
    expect(closed.turnout).toEqual({ votes_cast: 1, eligible: 40 });
  });
});

describe('Hash-chained audit log (§10.2, P10)', () => {
  test('chains verify end-to-end and inclusion proofs check out for third parties', () => {
    const w = world();
    const item = publishedItem(w);
    const objectRef = `heritage:${item.id}`;
    const chain = w.p.audit.chainFor(objectRef);
    expect(chain.length).toBeGreaterThanOrEqual(2); // submitted + published
    expect(w.p.audit.verifyChain(objectRef)).toEqual({ valid: true, length: chain.length });

    const proof = w.p.audit.inclusionProof(objectRef, chain[0].id);
    expect(AuditLog.verifyInclusion(proof)).toBe(true);
  });

  test('tampering with any past entry breaks verification', () => {
    const w = world();
    const item = publishedItem(w);
    const objectRef = `heritage:${item.id}`;
    const chain = w.p.audit.chainFor(objectRef);
    // Simulate an insider edit of a stored audit row (§13.2).
    w.p.audit.events.update(chain[0].id, { action: 'heritage.definitely_legit' });
    expect(w.p.audit.verifyChain(objectRef).valid).toBe(false);

    const proof = w.p.audit.inclusionProof(objectRef, chain[0].id);
    expect(AuditLog.verifyInclusion(proof)).toBe(false);
  });
});
