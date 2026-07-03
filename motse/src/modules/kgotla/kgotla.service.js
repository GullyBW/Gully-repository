'use strict';

const { id } = require('../../kernel/ids');
const { err } = require('../../kernel/errors');

/**
 * Kgotla — wards, notices, letsema, marketplace listings, civic alerts
 * (doc §3.2). Every civic-critical flow here has a USSD/SMS equivalent
 * (P9): the gateway calls these same methods.
 */
class KgotlaService {
  constructor({ store, clock, identity, audit, bus }) {
    this.wards = store.collection('wards');
    this.notices = store.collection('notices');
    this.letsemas = store.collection('letsemas');
    this.listings = store.collection('marketplace_listings');
    this.alerts = store.collection('civic_alerts');
    this.clock = clock;
    this.identity = identity;
    this.audit = audit;
    this.bus = bus;

    bus.register('kgotla.notice.published', 1, ['notice_id', 'ward_ref']);
    bus.register('kgotla.letsema.joined', 1, ['letsema_id', 'user_ref', 'channel']);
    bus.register('kgotla.alert.published', 1, ['alert_id', 'ward_ref', 'severity']);
  }

  // ── Wards ──────────────────────────────────────────────────────────

  createWard({ district, name, headmanOfficeRef }) {
    return this.wards.insert({
      id: id('ward'),
      district,
      name,
      verification_circle: [],
      headman_office_ref: headmanOfficeRef || null,
      created_at: this.clock.nowIso(),
    });
  }

  addToVerificationCircle(wardId, memberRef, actorRef) {
    const ward = this._ward(wardId);
    this.identity.requireRole(actorRef, 'headman_office', `ward:${wardId}`);
    this.wards.update(wardId, {
      verification_circle: [...ward.verification_circle, memberRef],
    });
    this.identity.grantRole(memberRef, 'verification_circle', `ward:${wardId}`, actorRef);
    return this.wards.get(wardId);
  }

  // ── Notices (L3 publishers only) ───────────────────────────────────

  publishNotice(wardId, publisherRef, { title, body, category = 'general' }) {
    this._ward(wardId);
    this.identity.requireLevel(publisherRef, 'L3');
    this.identity.requireRole(publisherRef, 'headman_office', `ward:${wardId}`);
    const notice = this.notices.insert({
      id: id('ntc'),
      ward_ref: wardId,
      publisher_ref: publisherRef,
      title,
      body,
      category,
      published_at: this.clock.nowIso(),
    });
    this.audit.append(publisherRef, 'kgotla.notice_published', `notice:${notice.id}`, null, { title });
    this.bus.publish('kgotla.notice.published', { notice_id: notice.id, ward_ref: wardId });
    return notice;
  }

  noticesFor(wardId) {
    return this.notices.find((n) => n.ward_ref === wardId);
  }

  // ── Letsema (communal work parties) ────────────────────────────────

  createLetsema(wardId, hostRef, { title, date, needed }) {
    this._ward(wardId);
    // Hosting a letsema requires ward verification (L2, §5.1).
    this.identity.requireLevel(hostRef, 'L2');
    return this.letsemas.insert({
      id: id('lts'),
      // Human-friendly short code — what "LETSEMA JOIN 42" refers to.
      short_code: String(this.letsemas.count() + 1),
      ward_ref: wardId,
      host_ref: hostRef,
      title,
      date,
      needed: needed || null,
      participants: [],
      created_at: this.clock.nowIso(),
    });
  }

  /**
   * Join — identical server-side whether it came from the app or a
   * Nokia brick via USSD/SMS (§8 "USSD parity"). Channel is recorded
   * for analytics only, never for behaviour.
   */
  joinLetsema(letsemaId, userRef, { channel = 'app', idempotencyKey } = {}) {
    const letsema = this.letsemas.get(letsemaId);
    if (!letsema) throw err('NOT_FOUND', `No letsema ${letsemaId}`);
    this.identity.requireLevel(userRef, 'L1');
    if (letsema.participants.some((p) => p.user_ref === userRef)) {
      return letsema; // idempotent join
    }
    const updated = this.letsemas.update(letsemaId, {
      participants: [
        ...letsema.participants,
        { user_ref: userRef, channel, joined_at: this.clock.nowIso() },
      ],
    });
    this.bus.publish('kgotla.letsema.joined', {
      letsema_id: letsemaId,
      user_ref: userRef,
      channel,
      idempotency_key: idempotencyKey || null,
    });
    return updated;
  }

  letsemaByShortCode(code) {
    return this.letsemas.findOne((l) => l.short_code === String(code));
  }

  // ── Marketplace (L2 gate — §13.2 platform abuse mitigations) ───────

  createListing(sellerRef, { wardRef, title, priceMinor, category }) {
    this.identity.requireLevel(sellerRef, 'L2'); // trading requires ward verification
    return this.listings.insert({
      id: id('lst'),
      seller_ref: sellerRef,
      ward_ref: wardRef,
      title,
      price_minor: priceMinor,
      category,
      state: 'active',
      created_at: this.clock.nowIso(),
    });
  }

  // ── Civic alerts (emergency category, L3 government senders) ───────

  publishAlert(wardId, senderRef, { severity, body }) {
    this._ward(wardId);
    this.identity.requireLevel(senderRef, 'L3');
    this.identity.requireRole(senderRef, 'government_alert_sender', `ward:${wardId}`);
    const alert = this.alerts.insert({
      id: id('alr'),
      ward_ref: wardId,
      sender_ref: senderRef,
      severity,
      body,
      published_at: this.clock.nowIso(),
    });
    this.audit.append(senderRef, 'kgotla.alert_published', `alert:${alert.id}`, null, { severity });
    this.bus.publish('kgotla.alert.published', {
      alert_id: alert.id,
      ward_ref: wardId,
      severity,
    });
    return alert;
  }

  _ward(wardId) {
    const ward = this.wards.get(wardId);
    if (!ward) throw err('NOT_FOUND', `No ward ${wardId}`);
    return ward;
  }
}

module.exports = { KgotlaService };
