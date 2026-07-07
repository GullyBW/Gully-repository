'use strict';

const { id, sha256, hmac, timingSafeEqual } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Developer platform (Phase 3, WS12). Lets universities, NGOs, tourism
 * operators and government partners integrate WITHOUT modifying the
 * core: OAuth-style API-key applications with scopes, per-app rate
 * limits and usage analytics, plus partner webhook subscriptions with
 * signed, retried delivery.
 *
 * API keys are shown ONCE at creation (only a hash is stored) and carry
 * a scope set that gates the public developer API. Everything a partner
 * does is attributable and rate-limited independently of member traffic.
 */
const SCOPES = [
  'public:read', // public transparency data (campaign ledgers, search)
  'heritage:read', // public heritage items
  'events:subscribe', // webhook subscriptions to domain events
  'payments:read', // a partner's own payment references
];

class DeveloperService {
  constructor({ store, clock, audit, bus, secrets, rateLimiterFactory }) {
    this.apps = store.collection('developer_apps');
    this.usage = store.collection('developer_usage');
    this.subscriptions = store.collection('webhook_subscriptions');
    this.deliveries = store.collection('webhook_deliveries');
    this.clock = clock;
    this.audit = audit;
    this.bus = bus;
    this.secrets = secrets;
    this.limiters = new Map(); // app_id -> RateLimiter
    this.rateLimiterFactory = rateLimiterFactory;

    bus.register('developer.app.created', 1, ['app_id', 'owner_ref']);
    // Fan every domain event out to matching partner subscriptions.
    this._pending = [];
    this._subscribeAll();
  }

  _subscribeAll() {
    for (const type of this.bus.schemas.keys()) {
      this.bus.subscribe(type, 'developer-webhooks', (event) => this._fanout(event));
    }
  }

  // ── Applications & API keys ────────────────────────────────────────

  createApp(ownerRef, { name, scopes = ['public:read'], rateLimitPerMin = 120 }) {
    for (const scope of scopes) {
      if (!SCOPES.includes(scope)) throw err('INVALID_ARGUMENT', `Unknown scope ${scope}`);
    }
    const appId = id('app');
    const rawKey = `msk_${sha256(id('key')).slice(0, 40)}`; // shown once
    const app = this.apps.insert({
      id: appId,
      owner_ref: ownerRef,
      name,
      key_hash: sha256(rawKey),
      key_prefix: rawKey.slice(0, 12),
      scopes,
      rate_limit_per_min: rateLimitPerMin,
      // A per-app signing secret for the partner's webhooks.
      webhook_secret: hmac(this.secrets.current('platform:token').value, appId),
      state: 'active',
      created_at: this.clock.nowIso(),
    });
    this.audit.append(ownerRef, 'developer.app_created', `app:${appId}`, null, { name, scopes });
    this.bus.publish('developer.app.created', { app_id: appId, owner_ref: ownerRef });
    // The raw key is returned ONCE and never stored.
    return { app: this._safe(app), api_key: rawKey };
  }

  revokeApp(appId, actor) {
    const app = this._app(appId);
    this.apps.update(appId, { state: 'revoked' });
    this.audit.append(actor, 'developer.app_revoked', `app:${appId}`, null, null);
    return { revoked: true, app_id: appId };
  }

  /** Authenticate a request by API key; enforce scope + per-app rate. */
  authenticate(rawKey, requiredScope) {
    if (!rawKey) throw err('UNAUTHENTICATED', 'API key required');
    const app = this.apps.findOne((a) => a.key_hash === sha256(rawKey) && a.state === 'active');
    if (!app) throw err('UNAUTHENTICATED', 'Invalid API key');
    if (requiredScope && !app.scopes.includes(requiredScope)) {
      throw err('PERMISSION_DENIED', `App lacks scope ${requiredScope}`, { required_scope: requiredScope });
    }
    if (!this._allow(app)) throw err('RATE_LIMITED', 'Developer app rate limit exceeded');
    this._recordUsage(app.id, requiredScope);
    return app;
  }

  _allow(app) {
    if (!this.rateLimiterFactory) return true;
    if (!this.limiters.has(app.id)) {
      this.limiters.set(
        app.id,
        this.rateLimiterFactory({ capacity: app.rate_limit_per_min, refillPerSecond: app.rate_limit_per_min / 60 })
      );
    }
    return this.limiters.get(app.id).allow(app.id);
  }

  _recordUsage(appId, scope) {
    const day = this.clock.nowIso().slice(0, 10);
    const row = this.usage.findOne((u) => u.app_id === appId && u.date === day);
    if (row) {
      this.usage.update(row.id, {
        calls: row.calls + 1,
        by_scope: { ...row.by_scope, [scope || 'none']: (row.by_scope[scope || 'none'] || 0) + 1 },
      });
    } else {
      this.usage.insert({
        id: id('usg'),
        app_id: appId,
        date: day,
        calls: 1,
        by_scope: { [scope || 'none']: 1 },
      });
    }
  }

  usageFor(appId) {
    this._app(appId);
    return this.usage.find((u) => u.app_id === appId);
  }

  // ── Webhook subscriptions (event subscriptions) ────────────────────

  subscribe(appId, { eventTypes, url }) {
    this._app(appId);
    if (!Array.isArray(eventTypes) || eventTypes.length === 0) {
      throw err('INVALID_ARGUMENT', 'eventTypes[] is required');
    }
    for (const type of eventTypes) {
      if (!this.bus.schemas.has(type)) throw err('INVALID_ARGUMENT', `Unknown event type ${type}`);
    }
    return this.subscriptions.insert({
      id: id('sub'),
      app_id: appId,
      event_types: eventTypes,
      url,
      state: 'active',
      failures: 0,
      created_at: this.clock.nowIso(),
    });
  }

  unsubscribe(subscriptionId, actor) {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw err('NOT_FOUND', `No subscription ${subscriptionId}`);
    this.subscriptions.update(subscriptionId, { state: 'cancelled' });
    this.audit.append(actor, 'developer.unsubscribed', `subscription:${subscriptionId}`, null, null);
    return { cancelled: true };
  }

  /**
   * Fan a domain event to matching subscriptions. Deliveries are queued
   * (recorded) with a signature partners verify; a pluggable transport
   * performs the HTTP POST — here we record and mark delivered so the
   * pipeline is fully testable. Public-safety: only whitelisted event
   * types (no restricted-content events) are ever delivered.
   */
  _fanout(event) {
    if (!PARTNER_SAFE_EVENTS.has(event.type)) return;
    // Restricted-content fail-closed: never disclose a members-only
    // heritage item's existence to partners, even its metadata.
    if (event.type === 'heritage.item.published' && event.data.visibility !== 'public') return;
    for (const sub of this.subscriptions.find(
      (s) => s.state === 'active' && s.event_types.includes(event.type)
    )) {
      const app = this.apps.get(sub.app_id);
      if (!app || app.state !== 'active') continue;
      const body = JSON.stringify({ type: event.type, id: event.id, occurred_at: event.occurred_at, data: event.data });
      const signature = hmac(app.webhook_secret, body);
      const delivery = this.deliveries.insert({
        id: id('whd'),
        subscription_id: sub.id,
        app_id: sub.app_id,
        event_id: event.id,
        event_type: event.type,
        body,
        signature,
        state: 'pending',
        attempts: 0,
        created_at: this.clock.nowIso(),
      });
      this._attemptDelivery(delivery.id);
    }
  }

  /** Injectable transport for real HTTP; default marks delivered (sandbox). */
  setTransport(transport) {
    this.transport = transport;
  }

  _attemptDelivery(deliveryId) {
    const delivery = this.deliveries.get(deliveryId);
    const sub = this.subscriptions.get(delivery.subscription_id);
    let ok = true;
    if (this.transport) {
      try {
        const res = this.transport.post(sub.url, delivery.body, {
          'X-Motse-Signature': delivery.signature,
          'X-Motse-Event': delivery.event_type,
        });
        ok = !!(res && res.ok);
      } catch (e) {
        ok = false;
      }
    }
    this.deliveries.update(deliveryId, {
      state: ok ? 'delivered' : 'failed',
      attempts: delivery.attempts + 1,
      delivered_at: ok ? this.clock.nowIso() : null,
    });
    if (!ok) {
      const failures = sub.failures + 1;
      // Auto-disable a subscription after repeated failures (partner is
      // down or misconfigured) — protects the platform from backpressure.
      this.subscriptions.update(sub.id, {
        failures,
        state: failures >= 10 ? 'suspended' : sub.state,
      });
    }
    return ok;
  }

  /** Retry failed deliveries (scheduler entry point). */
  retryFailedDeliveries() {
    let retried = 0;
    for (const delivery of this.deliveries.find((d) => d.state === 'failed' && d.attempts < 5)) {
      if (this._attemptDelivery(delivery.id)) retried += 1;
    }
    return { retried };
  }

  static verifySignature(app, body, signature) {
    return timingSafeEqual(hmac(app.webhook_secret, body), signature);
  }

  listApps(ownerRef) {
    return this.apps.find((a) => a.owner_ref === ownerRef).map((a) => this._safe(a));
  }

  _app(appId) {
    const app = this.apps.get(appId);
    if (!app) throw err('NOT_FOUND', `No app ${appId}`);
    return app;
  }

  _safe(app) {
    const { key_hash, webhook_secret, ...safe } = app;
    return safe;
  }
}

// Only public, non-sensitive event types are ever fanned out to partners.
const PARTNER_SAFE_EVENTS = new Set([
  'kgetsi.campaign.live',
  'kgetsi.contribution.received',
  'kgetsi.milestone.released',
  'loeto.booking.settled',
  'heritage.item.published', // publication of a PUBLIC item is public news
  'kgotla.notice.published',
  'kgotla.alert.published',
]);

module.exports = { DeveloperService, SCOPES, PARTNER_SAFE_EVENTS };
