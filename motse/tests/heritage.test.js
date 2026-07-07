'use strict';

/**
 * Cultural safety tests (doc §17): restricted-content leak tests run as
 * fail-closed gates — search index, analytics export, packs, read path.
 */
const { world, freshVerifiedUser, publishedItem } = require('./helpers');

describe('Heritage lifecycle (§10.1)', () => {
  test('contribution without a valid ConsentRecord is rejected (CONSENT_MISSING)', () => {
    const w = world();
    expect(() =>
      w.p.heritage.submit(w.mma.id, {
        type: 'audio',
        narratorRef: w.mma.id,
        morafeRef: 'bakalanga',
        visibility: 'public',
        consentRef: 'cst_nonexistent',
      })
    ).toThrow(expect.objectContaining({ code: 'CONSENT_MISSING' }));
  });

  test('publication never requires validation; custodians can only flag, never delete', () => {
    const w = world();
    const item = publishedItem(w);
    expect(item.state).toBe('published'); // no custodian in the loop
    // The service surface has no delete for custodians — flag is the ceiling.
    expect(w.p.heritage.validate).toBeDefined();
    expect(w.p.heritage.delete).toBeUndefined();
    const flagged = w.p.heritage.validate(item.id, custodian(w), { decision: 'flag' });
    expect(flagged.state).toBe('flagged');
    // The item still exists and its audit trail shows every transition.
    expect(w.p.audit.verifyChain(`heritage:${item.id}`).valid).toBe(true);
  });

  test('consent revocation triggers takedown of dependent items (§14)', () => {
    const w = world();
    const item = publishedItem(w);
    w.p.heritage.revokeConsent(item.consent_ref, w.mma.id);
    expect(() => w.p.heritage.read(item.id, w.mma.id)).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' })
    );
  });
});

describe('Restricted content — fail-closed enforcement (§6.4)', () => {
  test('members visibility: attested members read, everyone else gets MEMBERSHIP_REQUIRED', () => {
    const w = world();
    const item = publishedItem(w, { visibility: 'members' });
    expect(w.p.heritage.read(item.id, w.mma.id).id).toBe(item.id); // member
    expect(() => w.p.heritage.read(item.id, w.kabo.id)).toThrow(
      expect.objectContaining({ code: 'MEMBERSHIP_REQUIRED' })
    );
    expect(() => w.p.heritage.read(item.id, null)).toThrow(
      expect.objectContaining({ code: 'MEMBERSHIP_REQUIRED' })
    );
  });

  test('restricted metadata never enters the public search index or district packs', () => {
    const w = world();
    const publicItem = publishedItem(w, { visibility: 'public', title: 'Public story' });
    const membersItem = publishedItem(w, { visibility: 'members', title: 'Members story' });

    const index = w.p.heritage.publicSearchIndex().map((i) => i.id);
    expect(index).toContain(publicItem.id);
    expect(index).not.toContain(membersItem.id);

    const place = w.p.mafelo.createPlace({
      name: 'Tsodilo',
      district: 'ngamiland',
      geo: { lat: -18.75, lng: 21.73, radius_m: 500 },
      storyRefs: [publicItem.id, membersItem.id],
      sacredFlags: ['sacred_site'],
    });
    const manifest = w.p.mafelo.buildPackManifest('ngamiland');
    const shipped = manifest.entries.find((e) => e.place_id === place.id).story_refs;
    expect(shipped).toContain(publicItem.id);
    expect(shipped).not.toContain(membersItem.id); // restricted narration never ships (§11)
  });

  test('custodian restrict decision reclassifies attached media into the restricted class', () => {
    const w = world();
    const session = w.p.media.createUploadSession(w.mma.id, { type: 'audio', totalBytes: 4 });
    w.p.media.appendChunk(session.id, 0, 'abcd');
    const media = w.p.media.completeUpload(session.id, {});
    expect(media.media_class).toBe('general');

    const consent = w.p.heritage.recordConsent({
      subjectRef: w.mma.id,
      spokenAudioRef: 'med_consent',
      language: 'tn',
    });
    const item = w.p.heritage.submit(w.mma.id, {
      type: 'audio',
      narratorRef: w.mma.id,
      morafeRef: 'bakalanga',
      visibility: 'public',
      consentRef: consent.id,
      mediaRefs: [media.id],
    });
    w.p.heritage.publish(item.id, w.mma.id);
    w.p.heritage.validate(item.id, custodian(w), { decision: 'restrict' });

    const reclassified = w.p.media.get(media.id);
    expect(reclassified.media_class).toBe('restricted');
    expect(reclassified.bucket_class).toBe('restricted-cmek');
    expect(reclassified.no_derivatives_no_training).toBe(true);
    // Derivative/training pipelines fail closed on the flag.
    expect(() => w.p.media.assertDerivableForTraining(media.id)).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
    // Analytics export excludes the class at the query layer.
    expect(w.p.media.exportableItems().map((i) => i.id)).not.toContain(media.id);
  });

  test('restricted delivery URLs require attested membership and are identity-bound', () => {
    const w = world();
    const session = w.p.media.createUploadSession(w.mma.id, {
      type: 'audio',
      mediaClass: 'restricted',
      totalBytes: 2,
    });
    w.p.media.appendChunk(session.id, 0, 'xy');
    const media = w.p.media.completeUpload(session.id, {});
    expect(() => w.p.media.signUrl(media.id, { identityRef: w.kabo.id })).toThrow(
      expect.objectContaining({ code: 'MEMBERSHIP_REQUIRED' })
    );
    const attested = w.p.identity.attestMembership(w.mma.id, 'bakalanga');
    const signed = w.p.media.signUrl(media.id, {
      identityRef: w.mma.id,
      membershipAttested: attested,
    });
    const params = Object.fromEntries(new URLSearchParams(signed.url.split('?')[1]));
    expect(
      w.p.media.verifySignedUrl(media.id, { identity: params.identity, exp: params.exp, sig: params.sig })
    ).toBe(true);
    // Expired URLs die (short TTL, §6.4).
    w.p.clock.advance(6 * 60 * 1000);
    expect(
      w.p.media.verifySignedUrl(media.id, { identity: params.identity, exp: params.exp, sig: params.sig })
    ).toBe(false);
  });
});

describe('Deletion contract (§6.4): 14-day hard delete, 90-day purge, signed receipt', () => {
  test('withdrawal soft-deletes now, hard-deletes at 14d, purges with receipt at 90d', () => {
    const w = world();
    const session = w.p.media.createUploadSession(w.mma.id, { type: 'audio', totalBytes: 2 });
    w.p.media.appendChunk(session.id, 0, 'ab');
    const media = w.p.media.completeUpload(session.id, {});
    const consent = w.p.heritage.recordConsent({
      subjectRef: w.mma.id,
      spokenAudioRef: 'x',
      language: 'ik',
    });
    const item = w.p.heritage.submit(w.mma.id, {
      type: 'audio',
      narratorRef: w.mma.id,
      morafeRef: 'bakalanga',
      visibility: 'members',
      consentRef: consent.id,
      mediaRefs: [media.id],
    });
    w.p.heritage.publish(item.id, w.mma.id);

    w.p.heritage.withdraw(item.id, custodian(w), 'council decision');
    expect(w.p.media.get(media.id).deleted).toBe(true); // soft, immediately

    w.p.clock.advance(14 * 24 * 3600 * 1000 + 1000);
    w.p.media.runDeletionSweep();
    expect(w.p.media.get(media.id).deletion.state).toBe('hard_deleted');
    expect(w.p.media.get(media.id).derivatives).toHaveLength(0);

    w.p.clock.advance(76 * 24 * 3600 * 1000 + 1000);
    const receipts = w.p.media.runDeletionSweep();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].media_id).toBe(media.id);
    expect(receipts[0].signature).toBeTruthy(); // the council's completion receipt
  });
});

/** Grant mma a custodian seat over bakalanga and return her id. */
function custodian(w) {
  if (!w._custodianSeat) {
    const council = w.p.governance.createCouncil('bakalanga', w.admin.id);
    w._custodianSeat = w.p.governance.grantSeat(
      council.id,
      { kind: 'association', holderRef: w.mma.id },
      w.admin.id
    );
  }
  return w.mma.id;
}
