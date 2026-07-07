'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Heritage — Setso + Ditso (doc §3.2, §10.1, §6.4).
 *
 * Content lifecycle:
 *   submitted → published(community) → validated | annotated | restricted | flagged
 *                       └─ contested → ring1 → ring2 → resolved
 *
 * Hard rules, enforced in code (P4):
 *  - a submission REQUIRES a ConsentRecord (CONSENT_MISSING);
 *  - publication never requires validation;
 *  - custodians cannot delete — only flag for moderation review;
 *  - every transition writes an AuditEvent visible on the item;
 *  - visibility=members content is only readable with server-side
 *    membership attestation and never appears in public search.
 */
const VALIDATE_DECISIONS = ['elevate', 'annotate', 'restrict', 'flag'];

class HeritageService {
  constructor({ store, clock, identity, media, audit, bus, governance }) {
    this.items = store.collection('heritage_items');
    this.consents = store.collection('consent_records');
    this.clock = clock;
    this.identity = identity;
    this.media = media;
    this.audit = audit;
    this.bus = bus;
    this.governance = governance;

    bus.register('heritage.item.submitted', 1, ['item_id', 'morafe_ref']);
    bus.register('heritage.item.published', 1, ['item_id', 'morafe_ref', 'visibility']);
    bus.register('heritage.item.validated', 1, ['item_id', 'decision']);
    bus.register('heritage.item.withdrawn', 1, ['item_id']);
  }

  // ── Consent (§14: spoken consent in the subject's language) ────────

  recordConsent({ subjectRef, spokenAudioRef, language, scope }) {
    if (!spokenAudioRef || !language) {
      throw err('INVALID_ARGUMENT', 'Spoken-audio consent and its language are required');
    }
    return this.consents.insert({
      id: id('cst'),
      subject_ref: subjectRef,
      spoken_audio_ref: spokenAudioRef,
      language,
      scope: scope || 'heritage_contribution',
      timestamp: this.clock.nowIso(),
      revocation: null,
    });
  }

  revokeConsent(consentId, revokedBy) {
    const consent = this.consents.get(consentId);
    if (!consent) throw err('NOT_FOUND', `No consent ${consentId}`);
    this.consents.update(consentId, {
      revocation: { by: revokedBy, at: this.clock.nowIso() },
    });
    // Revocation triggers takedown of dependent items (§14).
    for (const item of this.items.find((i) => i.consent_ref === consentId && i.state !== 'withdrawn')) {
      this.withdraw(item.id, revokedBy, 'consent_revoked');
    }
  }

  // ── Submission & publication ───────────────────────────────────────

  submit(contributorRef, { type, narratorRef, morafeRef, villageRef, visibility, consentRef, mediaRefs, title }) {
    this.identity.requireLevel(contributorRef, 'L1'); // community-tier contribution
    const consent = this.consents.get(consentRef);
    if (!consent || consent.revocation) {
      throw err('CONSENT_MISSING', 'A valid ConsentRecord is required to contribute');
    }
    if (!['public', 'members', 'private'].includes(visibility)) {
      throw err('INVALID_ARGUMENT', `Unknown visibility ${visibility}`);
    }
    if (visibility === 'members' && !this.identity.attestMembership(contributorRef, morafeRef)) {
      throw err('MEMBERSHIP_REQUIRED', 'Members-only content requires morafe membership');
    }
    const item = this.items.insert({
      id: id('her'),
      type,
      title: title || null,
      narrator_ref: narratorRef,
      recorder_ref: contributorRef,
      morafe_ref: morafeRef,
      village_ref: villageRef || null,
      state: 'submitted',
      visibility,
      consent_ref: consentRef,
      media_refs: mediaRefs || [],
      transcript_refs: [],
      annotations: [],
      created_at: this.clock.nowIso(),
    });
    this.audit.append(contributorRef, 'heritage.submitted', `heritage:${item.id}`, null, {
      state: 'submitted',
    });
    this.bus.publish('heritage.item.submitted', { item_id: item.id, morafe_ref: morafeRef });
    return item;
  }

  /** Publication never requires validation (§10.1). */
  publish(itemId, actorRef) {
    const item = this._mustGet(itemId);
    if (item.state !== 'submitted') throw err('STATE_CONFLICT', `Cannot publish from ${item.state}`);
    if (actorRef !== item.recorder_ref) {
      throw err('PERMISSION_DENIED', 'Only the contributor publishes their submission');
    }
    const updated = this._transition(itemId, 'published', actorRef);
    this.bus.publish('heritage.item.published', {
      item_id: itemId,
      morafe_ref: item.morafe_ref,
      visibility: item.visibility,
    });
    return updated;
  }

  // ── Custodian validation (§7.2 :validate) ──────────────────────────

  validate(itemId, custodianRef, { decision, note }) {
    const item = this._mustGet(itemId);
    if (!VALIDATE_DECISIONS.includes(decision)) {
      throw err('INVALID_ARGUMENT', `decision must be one of ${VALIDATE_DECISIONS.join('|')}`);
    }
    // Frozen seats surface as SEAT_FROZEN here (Ring 3, §10.2).
    this.identity.requireRole(custodianRef, 'custodian', `morafe:${item.morafe_ref}`);
    if (!['published', 'validated', 'annotated'].includes(item.state)) {
      throw err('STATE_CONFLICT', `Cannot validate from ${item.state}`);
    }
    const nextState = { elevate: 'validated', annotate: 'annotated', restrict: 'restricted', flag: 'flagged' }[decision];
    let patch = {};
    if (decision === 'annotate') {
      patch.annotations = [...item.annotations, { by: custodianRef, note, ts: this.clock.nowIso() }];
    }
    if (decision === 'restrict') {
      // Restriction tightens visibility AND reclassifies every attached
      // media item into the restricted bucket class (§6.4).
      patch.visibility = 'members';
      for (const mediaRef of item.media_refs) {
        this.media.reclassifyRestricted(mediaRef);
      }
    }
    const updated = this._transition(itemId, nextState, custodianRef, patch);
    this.bus.publish('heritage.item.validated', { item_id: itemId, decision });
    return updated;
  }

  /** Contest: opens a governance dispute ring on the item (§10.1). */
  contest(itemId, raisedBy, summary) {
    const item = this._mustGet(itemId);
    this._transition(itemId, 'contested', raisedBy);
    return this.governance.openDispute(`heritage:${item.id}`, raisedBy, summary);
  }

  /**
   * Council withdrawal — triggers the deletion contract on media
   * (soft now, hard ≤14d, purge ≤90d, signed receipt) (§6.4).
   */
  withdraw(itemId, actorRef, reason) {
    const item = this._mustGet(itemId);
    const updated = this._transition(itemId, 'withdrawn', actorRef, { withdraw_reason: reason });
    for (const mediaRef of item.media_refs) {
      this.media.requestDeletion(mediaRef, actorRef);
    }
    this.bus.publish('heritage.item.withdrawn', { item_id: itemId });
    return updated;
  }

  // ── Read path (§6.4): membership attested server-side ──────────────

  read(itemId, readerRef) {
    const item = this._mustGet(itemId);
    if (item.state === 'withdrawn') throw err('NOT_FOUND', 'Item withdrawn');
    if (item.visibility === 'public') return item;
    if (item.visibility === 'private') {
      if (readerRef === item.recorder_ref || readerRef === item.narrator_ref) return item;
      throw err('PERMISSION_DENIED', 'Private item');
    }
    // members
    if (!readerRef || !this.identity.attestMembership(readerRef, item.morafe_ref)) {
      throw err('MEMBERSHIP_REQUIRED', undefined, { morafe_ref: item.morafe_ref });
    }
    return item;
  }

  /**
   * Public search projection — restricted metadata never enters public
   * indexes or sitemaps (§6.4). Fails closed: anything not explicitly
   * public and live is excluded.
   */
  publicSearchIndex() {
    return this.items.find(
      (i) =>
        i.visibility === 'public' &&
        ['published', 'validated', 'annotated'].includes(i.state)
    );
  }

  /** Feed for a morafe page; server resolves membership (§7.2). */
  feed(morafeRef, readerRef) {
    const isMember = readerRef ? this.identity.attestMembership(readerRef, morafeRef) : false;
    return this.items.find(
      (i) =>
        i.morafe_ref === morafeRef &&
        i.state !== 'withdrawn' &&
        i.state !== 'submitted' &&
        (i.visibility === 'public' || (i.visibility === 'members' && isMember))
    );
  }

  _transition(itemId, nextState, actorRef, patch = {}) {
    const item = this._mustGet(itemId);
    const updated = this.items.update(itemId, { ...patch, state: nextState });
    this.audit.append(actorRef, `heritage.${nextState}`, `heritage:${itemId}`,
      { state: item.state }, { state: nextState });
    return updated;
  }

  _mustGet(itemId) {
    const item = this.items.get(itemId);
    if (!item) throw err('NOT_FOUND', `No heritage item ${itemId}`);
    return item;
  }
}

module.exports = { HeritageService };
