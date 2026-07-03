'use strict';

const { id, hmac, timingSafeEqual } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Mafelo — places, geofences, site status, offline pack manifests
 * (doc §3.2, §11).
 *
 * Offline packs: per-district manifests bundle tiles, places, geofences
 * and story audio; packs are signed so tampered heritage audio will not
 * play (PACK_SIGNATURE_INVALID). Restricted narration layers simply do
 * not ship in public packs — exclusion at build time, fail closed.
 */
class MafeloService {
  constructor({ store, clock, heritage, identity, secret = 'motse-pack-secret' }) {
    this.places = store.collection('places');
    this.packs = store.collection('offline_packs');
    this.clock = clock;
    this.heritage = heritage;
    this.identity = identity;
    this.secret = secret;
  }

  createPlace({ name, district, geo, morafeRefs = [], storyRefs = [], sacredFlags = [] }) {
    return this.places.insert({
      id: id('plc'),
      name,
      district,
      geo, // { lat, lng, radius_m } — doubles as the geofence
      morafe_refs: morafeRefs,
      story_refs: storyRefs, // heritage item ids narrating this place
      status_feed: [],
      sacred_flags: sacredFlags,
      created_at: this.clock.nowIso(),
    });
  }

  addStory(placeId, heritageItemId) {
    const place = this._place(placeId);
    return this.places.update(placeId, { story_refs: [...place.story_refs, heritageItemId] });
  }

  postStatus(placeId, authorRef, status) {
    const place = this._place(placeId);
    return this.places.update(placeId, {
      status_feed: [...place.status_feed, { by: authorRef, status, ts: this.clock.nowIso() }],
    });
  }

  /**
   * GET /v1/mafelo/packs/{district}/manifest
   *
   * Public packs contain ONLY public, live stories. The filter runs
   * against the heritage read model — the same rule as the public
   * search index, so a restricted item can never leak through a pack.
   */
  buildPackManifest(district) {
    const places = this.places.find((p) => p.district === district);
    const publicIds = new Set(this.heritage.publicSearchIndex().map((i) => i.id));
    const entries = places.map((place) => ({
      place_id: place.id,
      name: place.name,
      geofence: place.geo,
      sacred_flags: place.sacred_flags,
      // Restricted narration layers do not ship in public packs (§11).
      story_refs: place.story_refs.filter((ref) => publicIds.has(ref)),
    }));
    const manifest = {
      id: id('pak'),
      district,
      version: this.clock.nowMs(),
      entries,
      built_at: this.clock.nowIso(),
    };
    manifest.signature = this._sign(manifest);
    this.packs.insert({ ...manifest });
    return manifest;
  }

  /** Client-side check modelled server-side: tampered packs won't play. */
  verifyPack(manifest) {
    const { signature, ...unsigned } = manifest;
    if (!signature || !timingSafeEqual(this._sign(unsigned), signature)) {
      throw err('PACK_SIGNATURE_INVALID');
    }
    return true;
  }

  /**
   * On-device geofence evaluation (modelled): triggers evaluate against
   * the downloaded pack's geofence set — no server round-trip (§11).
   */
  static evaluateGeofences(manifest, { lat, lng }) {
    const hits = [];
    for (const entry of manifest.entries) {
      const g = entry.geofence;
      if (!g) continue;
      const dLat = ((lat - g.lat) * Math.PI) / 180;
      const dLng = ((lng - g.lng) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((g.lat * Math.PI) / 180) * Math.cos((lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
      const meters = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (meters <= (g.radius_m || 100)) {
        hits.push({ place_id: entry.place_id, story_refs: entry.story_refs });
      }
    }
    return hits;
  }

  _sign(manifest) {
    return hmac(
      this.secret,
      JSON.stringify({
        district: manifest.district,
        version: manifest.version,
        entries: manifest.entries,
      })
    );
  }

  _place(placeId) {
    const place = this.places.get(placeId);
    if (!place) throw err('NOT_FOUND', `No place ${placeId}`);
    return place;
  }
}

module.exports = { MafeloService };
