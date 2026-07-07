'use strict';

const { id } = require('../kernel/ids');
const { err } = require('../kernel/errors');

/**
 * Notification service (doc §12) — event-driven, multi-channel.
 *
 * Channels: in_app (always available), sms, push (FCM-shaped with
 * collapse keys + quiet hours), email, whatsapp (future adapter — the
 * interface exists, delivery reports "unavailable" until an adapter is
 * registered). Adapters are injectable transports; the sandbox
 * transports record deliveries so the full pipeline is testable.
 *
 * Rules from the doc:
 *  - every push/SMS category is user-controllable;
 *  - civic emergency alerts are the single exempt category, delivered
 *    regardless of preferences (§12);
 *  - quiet hours suppress push, never in_app.
 */
const CHANNELS = ['in_app', 'sms', 'push', 'email', 'whatsapp'];
const EXEMPT_CATEGORIES = new Set(['civic_emergency']);
const DEFAULT_PREFS = { in_app: true, sms: false, push: true, email: false, whatsapp: false };

class NotificationService {
  constructor({ store, clock, bus, identity }, adapters = {}) {
    this.inbox = store.collection('notifications_inbox');
    this.deliveries = store.collection('notification_deliveries');
    this.prefs = store.collection('notification_prefs');
    this.clock = clock;
    this.bus = bus;
    this.identity = identity;
    this.adapters = {
      sms: adapters.sms || { send: () => ({ delivered: true, transport: 'sandbox-sms' }) },
      push: adapters.push || { send: () => ({ delivered: true, transport: 'sandbox-push' }) },
      email: adapters.email || { send: () => ({ delivered: true, transport: 'sandbox-email' }) },
      whatsapp: adapters.whatsapp || null, // future adapter (interface only)
    };

    bus.register('notification.dispatched', 1, ['notification_id', 'user_ref', 'category']);
    this._subscribeDomainEvents();
  }

  /** The event-driven wiring: domain events → notifications. */
  _subscribeDomainEvents() {
    const sub = (type, handler) => this.bus.subscribe(type, 'notification-service', handler);

    sub('kgotla.alert.published', (e) =>
      this._fanOutWard(e.data.ward_ref, {
        category: 'civic_emergency',
        title: 'Civic alert',
        body: `Severity ${e.data.severity}`,
        ref: `alert:${e.data.alert_id}`,
      })
    );
    sub('kgotla.notice.published', (e) =>
      this._fanOutWard(e.data.ward_ref, {
        category: 'ward_notices',
        title: 'New ward notice',
        body: null,
        ref: `notice:${e.data.notice_id}`,
      })
    );
    sub('ledger.payout.settled', (e) => {
      const account = this._accountOwner(e.data.account_id);
      if (account) {
        this.notify(account, {
          category: 'payments',
          title: 'Payout delivered',
          body: `BWP ${(e.data.amount_minor / 100).toFixed(2)} sent to your mobile money`,
          ref: `payout:${e.data.payout_id}`,
        });
      }
    });
    sub('payments.intent.completed', (e) => {
      if (e.data.actor_ref) {
        this.notify(e.data.actor_ref, {
          category: 'payments',
          title: `Payment ${e.data.type} completed`,
          body: `BWP ${(e.data.amount_minor / 100).toFixed(2)} via ${e.data.provider}`,
          ref: `intent:${e.data.intent_id}`,
        });
      }
    });
    sub('payments.intent.failed', (e) => {
      if (e.data.actor_ref) {
        this.notify(e.data.actor_ref, {
          category: 'payments',
          title: 'Payment failed',
          body: e.data.reason || 'The operator declined the transaction',
          ref: `intent:${e.data.intent_id}`,
        });
      }
    });
    sub('kgetsi.milestone.released', (e) =>
      this._noop(e) // campaign followers fan-out is a Phase-2 projection
    );
    sub('governance.dispute.opened', (e) => this._noop(e));
    sub('ledger.reconciliation.variance', (e) => {
      // Operational alert to platform admins (Sev-1 page, §9.2).
      for (const admin of this.identity.roles.find(
        (g) => g.role === 'platform_admin' && !g.suspended
      )) {
        this.notify(admin.user_ref, {
          category: 'ops_alerts',
          title: 'Reconciliation variance — Sev-1',
          body: `Variance of ${e.data.variance_minor} thebe detected`,
          ref: 'reconciliation',
        });
      }
    });
  }

  _noop() {}

  _accountOwner(accountId) {
    // Payout accounts are owned by user ids; other owners are org refs.
    const account = this._ledgerAccounts && this._ledgerAccounts.get(accountId);
    if (account && String(account.owner_ref).startsWith('usr_')) return account.owner_ref;
    return null;
  }

  /** Late-bound to avoid a constructor cycle with the ledger. */
  bindLedgerAccounts(accountsCollection) {
    this._ledgerAccounts = accountsCollection;
  }

  /**
   * Localization (Phase 3, WS13). Once bound, notify() accepts an
   * optional titleKey/params and renders the title in the recipient's
   * language (Setswana-first). Fully backward compatible: callers that
   * pass a literal `title` are unaffected.
   */
  bindI18n(i18n, identity) {
    this._i18n = i18n;
    this._i18nIdentity = identity;
  }

  _localizeTitle(userRef, { title, titleKey, params }) {
    if (!titleKey || !this._i18n) return title;
    const user = this._i18nIdentity ? this._i18nIdentity.users.get(userRef) : null;
    const locale = this._i18n.localeFor(user);
    return this._i18n.t(titleKey, { locale, params: params || {} });
  }

  // ── Preferences ────────────────────────────────────────────────────

  setPreference(userRef, category, channels) {
    for (const channel of Object.keys(channels)) {
      if (!CHANNELS.includes(channel)) throw err('INVALID_ARGUMENT', `Unknown channel ${channel}`);
    }
    const existing = this.prefs.findOne((p) => p.user_ref === userRef && p.category === category);
    if (existing) return this.prefs.update(existing.id, { channels: { ...existing.channels, ...channels } });
    return this.prefs.insert({
      id: id('npf'),
      user_ref: userRef,
      category,
      channels: { ...DEFAULT_PREFS, ...channels },
      quiet_hours: null, // { start_hour, end_hour } local
    });
  }

  setQuietHours(userRef, category, quietHours) {
    const existing = this.prefs.findOne((p) => p.user_ref === userRef && p.category === category);
    if (existing) return this.prefs.update(existing.id, { quiet_hours: quietHours });
    return this.prefs.insert({
      id: id('npf'),
      user_ref: userRef,
      category,
      channels: { ...DEFAULT_PREFS },
      quiet_hours: quietHours,
    });
  }

  _prefsFor(userRef, category) {
    const p = this.prefs.findOne((x) => x.user_ref === userRef && x.category === category);
    return p || { channels: DEFAULT_PREFS, quiet_hours: null };
  }

  _inQuietHours(pref) {
    if (!pref.quiet_hours) return false;
    const hour = this.clock.now().getUTCHours();
    const { start_hour: start, end_hour: end } = pref.quiet_hours;
    return start < end ? hour >= start && hour < end : hour >= start || hour < end;
  }

  // ── Dispatch ───────────────────────────────────────────────────────

  notify(userRef, { category, title, titleKey, params, body, ref, collapseKey }) {
    const pref = this._prefsFor(userRef, category);
    const exempt = EXEMPT_CATEGORIES.has(category);
    const resolvedTitle = this._localizeTitle(userRef, { title, titleKey, params });
    title = resolvedTitle;
    const notification = this.inbox.insert({
      id: id('ntf'),
      user_ref: userRef,
      category,
      title,
      body: body || null,
      ref: ref || null,
      read: false,
      created_at: this.clock.nowIso(),
    });

    const wanted = (channel) => exempt || pref.channels[channel];
    const quiet = !exempt && this._inQuietHours(pref);

    if (wanted('sms')) this._deliver(notification, 'sms', { to: userRef, body: `${title}${body ? ` — ${body}` : ''}` });
    if (wanted('push') && !quiet) {
      this._deliver(notification, 'push', {
        to: userRef,
        title,
        body,
        collapse_key: collapseKey || category,
      });
    }
    if (wanted('email')) this._deliver(notification, 'email', { to: userRef, subject: title, body });
    if (pref.channels.whatsapp || (exempt && this.adapters.whatsapp)) {
      this._deliver(notification, 'whatsapp', { to: userRef, body: `${title}${body ? ` — ${body}` : ''}` });
    }

    this.bus.publish('notification.dispatched', {
      notification_id: notification.id,
      user_ref: userRef,
      category,
    });
    return notification;
  }

  _deliver(notification, channel, payload) {
    const adapter = this.adapters[channel];
    let receipt;
    if (!adapter) {
      receipt = { delivered: false, transport: 'unavailable' }; // whatsapp until an adapter ships
    } else {
      try {
        receipt = adapter.send(payload);
      } catch (e) {
        receipt = { delivered: false, error: e.message };
      }
    }
    this.deliveries.insert({
      id: id('dlv'),
      notification_id: notification.id,
      channel,
      delivered: !!receipt.delivered,
      transport: receipt.transport || channel,
      error: receipt.error || null,
      ts: this.clock.nowIso(),
    });
    return receipt;
  }

  _fanOutWard(wardRef, message) {
    for (const resident of this.identity.users.find((u) => u.ward_ref === wardRef)) {
      this.notify(resident.id, message);
    }
  }

  // ── Read API ───────────────────────────────────────────────────────

  inboxFor(userRef) {
    return this.inbox.find((n) => n.user_ref === userRef);
  }

  markRead(notificationId, userRef) {
    const notification = this.inbox.get(notificationId);
    if (!notification || notification.user_ref !== userRef) {
      throw err('NOT_FOUND', `No notification ${notificationId}`);
    }
    return this.inbox.update(notificationId, { read: true });
  }

  deliveryStats() {
    const all = this.deliveries.find();
    const byChannel = {};
    for (const delivery of all) {
      byChannel[delivery.channel] = byChannel[delivery.channel] || { sent: 0, failed: 0 };
      if (delivery.delivered) byChannel[delivery.channel].sent += 1;
      else byChannel[delivery.channel].failed += 1;
    }
    return { total: all.length, by_channel: byChannel };
  }
}

module.exports = { NotificationService, CHANNELS };
