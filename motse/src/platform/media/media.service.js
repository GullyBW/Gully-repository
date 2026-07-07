'use strict';

const { id, sha256, hmac, timingSafeEqual } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Media service (doc §6.3, §6.4) — extracted day one.
 *
 * Capture → encrypted local file → resumable upload session (survives
 * multi-day interruptions) → integrity check → transcode fan-out →
 * publication event. Originals are immutable; derivatives disposable.
 *
 * Restricted-class media (visibility=members):
 *  - isolated bucket class, separate keys (modelled as bucket_class);
 *  - never enters shared CDN caches — delivery is per-identity,
 *    short-TTL signed URLs;
 *  - carries no_derivatives_no_training honoured by every pipeline job.
 */
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

const RENDITIONS = {
  audio: ['opus_16k', 'opus_24k', 'opus_48k', 'waveform_json'],
  video: ['h264_240p', 'h264_480p', 'h264_720p', 'thumbnail'],
  image: ['thumb', 'med', 'full'],
  text: [],
  document: [],
};

class MediaService {
  constructor({ store, clock, bus, secret = 'motse-media-secret' }) {
    this.sessions = store.collection('upload_sessions');
    this.items = store.collection('media_items');
    this.clock = clock;
    this.bus = bus;
    this.secret = secret;

    bus.register('media.item.ready', 1, ['media_id', 'media_class']);
    bus.subscribe('media.item.ready', 'transcode-worker', (event) =>
      this._transcode(event.data.media_id)
    );
  }

  // ── Resumable upload sessions (tus-style) ──────────────────────────

  createUploadSession(ownerRef, { type, mediaClass = 'general', totalBytes }) {
    if (!RENDITIONS[type]) throw err('INVALID_ARGUMENT', `Unknown media type ${type}`);
    if (!['general', 'restricted'].includes(mediaClass)) {
      throw err('INVALID_ARGUMENT', `Unknown media class ${mediaClass}`);
    }
    return this.sessions.insert({
      id: id('ups'),
      owner_ref: ownerRef,
      type,
      media_class: mediaClass,
      total_bytes: totalBytes,
      received_bytes: 0,
      chunks: [],
      state: 'open',
      created_at: this.clock.nowIso(),
    });
  }

  /**
   * Append a chunk at an offset. Out-of-order or duplicate chunks are
   * tolerated (offset-addressed) so a session survives restarts and
   * multi-day gaps — no accepted byte is ever lost (§15.1).
   */
  appendChunk(sessionId, offset, bytes) {
    const session = this._openSession(sessionId);
    if (offset > session.received_bytes) {
      // Gap — client must resume from received_bytes.
      return { session, resume_from: session.received_bytes };
    }
    const fresh = offset + bytes.length - session.received_bytes;
    if (fresh > 0) {
      this.sessions.update(sessionId, {
        received_bytes: session.received_bytes + fresh,
        chunks: [...session.chunks, { offset, length: bytes.length, digest: sha256(bytes) }],
      });
    }
    const updated = this.sessions.get(sessionId);
    return { session: updated, resume_from: updated.received_bytes };
  }

  /** Complete: integrity check, then transcode fan-out via the bus. */
  completeUpload(sessionId, { contentDigest, noDerivativesNoTraining = false }) {
    const session = this._openSession(sessionId);
    if (session.total_bytes && session.received_bytes < session.total_bytes) {
      throw err('STATE_CONFLICT', 'Upload incomplete', {
        received_bytes: session.received_bytes,
        total_bytes: session.total_bytes,
      });
    }
    this.sessions.update(sessionId, { state: 'completed' });
    const item = this.items.insert({
      id: id('med'),
      owner_ref: session.owner_ref,
      type: session.type,
      media_class: session.media_class,
      bucket_class: session.media_class === 'restricted' ? 'restricted-cmek' : 'general',
      original_digest: contentDigest || null,
      // Restricted items always carry the flag; general items may opt in.
      no_derivatives_no_training: session.media_class === 'restricted' || noDerivativesNoTraining,
      derivatives: [],
      state: 'processing',
      deleted: false,
      created_at: this.clock.nowIso(),
    });
    this.bus.publish('media.item.ready', { media_id: item.id, media_class: item.media_class });
    return item;
  }

  /** Transcode worker: derivatives are regenerable, never the original. */
  _transcode(mediaId) {
    const item = this.items.get(mediaId);
    if (!item || item.state !== 'processing') return; // idempotent consumer
    const derivatives = RENDITIONS[item.type].map((rendition) => ({
      rendition,
      object_ref: `${item.bucket_class}/${item.id}/${rendition}`,
    }));
    this.items.update(mediaId, { derivatives, state: 'available' });
  }

  // ── Delivery (§6.4 read path) ──────────────────────────────────────

  /**
   * Mint a delivery URL. Restricted media requires the caller to have
   * attested membership server-side FIRST — the attestation result is
   * passed in, and the URL is bound to that identity with a short TTL.
   */
  signUrl(mediaId, { identityRef, membershipAttested = false }) {
    const item = this._mustGet(mediaId);
    if (item.deleted) throw err('NOT_FOUND', 'Media deleted');
    if (item.media_class === 'restricted') {
      if (!membershipAttested) throw err('MEMBERSHIP_REQUIRED');
      if (!identityRef) throw err('UNAUTHENTICATED', 'Restricted URLs are identity-bound');
    }
    const expiresAt = this.clock.nowMs() + SIGNED_URL_TTL_MS;
    const payload = `${mediaId}|${identityRef || 'public'}|${expiresAt}`;
    return {
      url: `/media/${mediaId}?identity=${identityRef || 'public'}&exp=${expiresAt}&sig=${hmac(this.secret, payload)}`,
      expires_at: expiresAt,
    };
  }

  verifySignedUrl(mediaId, { identity, exp, sig }) {
    const payload = `${mediaId}|${identity}|${exp}`;
    if (!timingSafeEqual(hmac(this.secret, payload), sig)) return false;
    return Number(exp) > this.clock.nowMs();
  }

  /**
   * Tighten an item to the restricted class (custodian `restrict`
   * decisions propagate here): isolated bucket class, no-training flag.
   * One-way — restriction never loosens through this path.
   */
  reclassifyRestricted(mediaId) {
    this._mustGet(mediaId);
    return this.items.update(mediaId, {
      media_class: 'restricted',
      bucket_class: 'restricted-cmek',
      no_derivatives_no_training: true,
    });
  }

  /**
   * Pipeline guard: every derivative/export/training job MUST call this.
   * Fails closed — restricted or flagged content never feeds derived
   * pipelines beyond its own renditions (§6.4 derivative ban).
   */
  assertDerivableForTraining(mediaId) {
    const item = this._mustGet(mediaId);
    if (item.no_derivatives_no_training) {
      throw err('PERMISSION_DENIED', 'no_derivatives_no_training flag set', {
        media_id: mediaId,
      });
    }
    return true;
  }

  /** Analytics-export view: restricted class excluded at the query layer. */
  exportableItems() {
    return this.items.find(
      (i) => i.media_class !== 'restricted' && !i.no_derivatives_no_training && !i.deleted
    );
  }

  // ── Deletion contract (§6.4): 14-day hard delete, 90-day purge ─────

  requestDeletion(mediaId, requestedBy) {
    const item = this._mustGet(mediaId);
    const softDeleted = this.items.update(mediaId, {
      deleted: true, // soft-delete immediately
      deletion: {
        requested_by: requestedBy,
        requested_at: this.clock.nowIso(),
        hard_delete_by: new Date(this.clock.nowMs() + 14 * 24 * 3600 * 1000).toISOString(),
        backup_purge_by: new Date(this.clock.nowMs() + 90 * 24 * 3600 * 1000).toISOString(),
        state: 'soft_deleted',
      },
    });
    return softDeleted.deletion;
  }

  /** Scheduled job: hard-delete then purge, emitting a signed receipt. */
  runDeletionSweep() {
    const receipts = [];
    for (const item of this.items.find((i) => i.deleted && i.deletion)) {
      const deletion = { ...item.deletion };
      if (deletion.state === 'soft_deleted' && this.clock.nowIso() >= deletion.hard_delete_by) {
        deletion.state = 'hard_deleted';
        this.items.update(item.id, { derivatives: [], deletion });
      }
      if (deletion.state === 'hard_deleted' && this.clock.nowIso() >= deletion.backup_purge_by) {
        deletion.state = 'purged';
        const receiptPayload = `${item.id}|purged|${this.clock.nowIso()}`;
        deletion.completion_receipt = {
          media_id: item.id,
          purged_at: this.clock.nowIso(),
          signature: hmac(this.secret, receiptPayload),
          payload: receiptPayload,
        };
        this.items.update(item.id, { deletion });
        receipts.push(deletion.completion_receipt);
      }
    }
    return receipts;
  }

  get(mediaId) {
    return this._mustGet(mediaId);
  }

  _mustGet(mediaId) {
    const item = this.items.get(mediaId);
    if (!item) throw err('NOT_FOUND', `No media ${mediaId}`);
    return item;
  }

  _openSession(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw err('NOT_FOUND', `No upload session ${sessionId}`);
    if (session.state !== 'open') throw err('STATE_CONFLICT', 'Upload session is closed');
    return session;
  }
}

module.exports = { MediaService, SIGNED_URL_TTL_MS };
