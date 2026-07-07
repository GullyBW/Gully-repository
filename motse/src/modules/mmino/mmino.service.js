'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Mmino — catalogue, streaming entitlements, tipping (doc §3.2, last
 * phase). Tips ride the Ledger (P3); streams of restricted recordings
 * inherit the same signed-URL delivery as all restricted media.
 */
class MminoService {
  constructor({ store, clock, identity, ledger, media }) {
    this.tracks = store.collection('mmino_tracks');
    this.entitlements = store.collection('mmino_entitlements');
    this.clock = clock;
    this.identity = identity;
    this.ledger = ledger;
    this.media = media;
  }

  publishTrack(artistRef, { title, mediaRef, priceMinor = 0 }) {
    this.identity.requireLevel(artistRef, 'L1');
    return this.tracks.insert({
      id: id('trk'),
      artist_ref: artistRef,
      title,
      media_ref: mediaRef,
      price_minor: priceMinor,
      created_at: this.clock.nowIso(),
    });
  }

  /** Paid tracks require purchase; free tracks are entitled to everyone. */
  purchase(trackId, listenerRef, { sourceAccountId, artistAccountId, idempotencyKey }) {
    const track = this._track(trackId);
    if (track.price_minor === 0) return this._entitle(trackId, listenerRef, null);
    const posting = this.ledger.transfer({
      source: sourceAccountId,
      dest: artistAccountId,
      amountMinor: track.price_minor,
      purpose: 'mmino_purchase',
      ref: `track:${trackId}`,
      idempotencyKey,
      actorRef: listenerRef,
    });
    return this._entitle(trackId, listenerRef, posting.id);
  }

  /** Streaming URL: entitlement + the media layer's own restrictions. */
  streamUrl(trackId, listenerRef, { membershipAttested = false } = {}) {
    const track = this._track(trackId);
    if (track.price_minor > 0) {
      const entitled = this.entitlements.findOne(
        (e) => e.track_ref === trackId && e.listener_ref === listenerRef
      );
      if (!entitled) throw err('PERMISSION_DENIED', 'No streaming entitlement for this track');
    }
    return this.media.signUrl(track.media_ref, { identityRef: listenerRef, membershipAttested });
  }

  /** Tipping: artist tips use the same payout rails (§9.3). */
  tip(trackId, tipperRef, { sourceAccountId, artistAccountId, amountMinor, idempotencyKey }) {
    this._track(trackId);
    return this.ledger.transfer({
      source: sourceAccountId,
      dest: artistAccountId,
      amountMinor,
      purpose: 'mmino_tip',
      ref: `track:${trackId}:tip`,
      idempotencyKey,
      actorRef: tipperRef,
    });
  }

  _entitle(trackId, listenerRef, postingRef) {
    return this.entitlements.insert({
      id: id('ent'),
      track_ref: trackId,
      listener_ref: listenerRef,
      posting_ref: postingRef,
      granted_at: this.clock.nowIso(),
    });
  }

  _track(trackId) {
    const track = this.tracks.get(trackId);
    if (!track) throw err('NOT_FOUND', `No track ${trackId}`);
    return track;
  }
}

module.exports = { MminoService };
