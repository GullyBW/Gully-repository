'use strict';

const { sha256 } = require('../kernel/ids');

/**
 * Analytics platform (Phase 2, WS5) — event-sourced aggregates only.
 *
 * PII rule (per the brief and doc §6.1 BigQuery constraints): nothing
 * identifying is stored — active-user sets hold truncated SHA-256 of
 * pseudonymous user ids, search terms are counted without user linkage,
 * and every read API returns aggregates. Raw stores remain the domain
 * modules' business; this service only ever counts.
 */
class AnalyticsService {
  constructor({ clock, bus, platform }) {
    this.clock = clock;
    this.bus = bus;
    this.platform = platform;
    this.days = new Map(); // 'YYYY-MM-DD' -> { users:Set, features:Map, events:Map }
    this.searchTerms = new Map(); // term -> count (no user linkage)
    this.counters = new Map(); // name -> count (lifetime)

    const count = (name) => (this.counters.set(name, (this.counters.get(name) || 0) + 1));
    const sub = (type, fn) => bus.subscribe(type, 'analytics', fn);

    sub('payments.intent.completed', (e) => {
      count(`payments.completed.${e.data.provider}`);
      this._bump('payments.completed');
    });
    sub('payments.intent.failed', (e) => {
      count(`payments.failed.${e.data.provider}`);
      this._bump('payments.failed');
    });
    sub('kgetsi.contribution.received', () => this._bump('kgetsi.contribution'));
    sub('kgetsi.milestone.released', () => this._bump('kgetsi.milestone_released'));
    sub('loeto.booking.settled', () => this._bump('loeto.booking_settled'));
    sub('heritage.item.published', () => this._bump('heritage.published'));
    sub('heritage.item.validated', () => this._bump('heritage.validated'));
    sub('kgotla.letsema.joined', (e) => {
      this._bump('kgotla.letsema_joined');
      if (e.data.channel !== 'app') this._bump('kgotla.letsema_joined.offline_channel');
    });
    sub('notification.dispatched', () => this._bump('notifications.dispatched'));
    sub('pilot.ward.enrolled', () => this._bump('pilot.ward_enrolled'));
  }

  _day(date) {
    const key = (date || this.clock.nowIso()).slice(0, 10);
    if (!this.days.has(key)) {
      this.days.set(key, { users: new Set(), features: new Map(), events: new Map() });
    }
    return this.days.get(key);
  }

  _bump(event) {
    const day = this._day();
    day.events.set(event, (day.events.get(event) || 0) + 1);
  }

  /** Pseudonymise before anything is stored. */
  static anon(userRef) {
    return sha256(String(userRef)).slice(0, 16);
  }

  // ── Ingestion hooks ────────────────────────────────────────────────

  /** Called per authenticated request (app middleware): DAU + feature use. */
  recordRequest(path, userRef, statusCode) {
    if (statusCode >= 400) return; // failures are monitoring's job, not usage
    const day = this._day();
    if (userRef) day.users.add(AnalyticsService.anon(userRef));
    const feature = AnalyticsService.featureOf(path);
    if (feature) day.features.set(feature, (day.features.get(feature) || 0) + 1);
    if (feature === 'sync') this._bump('offline.sync_batch');
  }

  static featureOf(path) {
    const match = String(path).match(/^\/v1\/([a-z]+)/);
    return match ? match[1] : null;
  }

  /** Search terms counted with no user linkage (PII rule). */
  trackSearch(query) {
    this._bump('search.query');
    for (const term of String(query || '').toLowerCase().split(/\W+/).filter((t) => t.length > 2)) {
      this.searchTerms.set(term, (this.searchTerms.get(term) || 0) + 1);
    }
  }

  // ── Read API (aggregates only) ─────────────────────────────────────

  activeUsers(dateIso) {
    return this._day(dateIso).users.size;
  }

  /** DAU series + MAU (30-day union) as of `asOf`. */
  activity(asOf) {
    const end = new Date(asOf || this.clock.nowIso());
    const series = [];
    const union = new Set();
    for (let i = 29; i >= 0; i -= 1) {
      const day = new Date(end.getTime() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const bucket = this.days.get(day);
      const dau = bucket ? bucket.users.size : 0;
      if (bucket) for (const u of bucket.users) union.add(u);
      series.push({ date: day, dau });
    }
    return { series, mau: union.size, dau_today: series[series.length - 1].dau };
  }

  featureUsage(dateIso) {
    return Object.fromEntries(this._day(dateIso).features);
  }

  /** Verification funnel from the live identity graph (aggregate only). */
  verificationConversion() {
    const byLevel = { L0: 0, L1: 0, L2: 0, L3: 0 };
    for (const user of this.platform.identity.users.find()) byLevel[user.level] += 1;
    const total = Object.values(byLevel).reduce((a, b) => a + b, 0) || 1;
    return {
      by_level: byLevel,
      l0_to_l1_pct: Math.round(((byLevel.L1 + byLevel.L2 + byLevel.L3) / total) * 100),
      l1_to_l2_pct:
        byLevel.L1 + byLevel.L2 + byLevel.L3 > 0
          ? Math.round(((byLevel.L2 + byLevel.L3) / (byLevel.L1 + byLevel.L2 + byLevel.L3)) * 100)
          : 0,
    };
  }

  paymentConversion() {
    const intents = this.platform.payments.intents.find();
    const byState = {};
    for (const intent of intents) byState[intent.state] = (byState[intent.state] || 0) + 1;
    const completed = byState.completed || 0;
    return {
      initiated: intents.length,
      by_state: byState,
      conversion_pct: intents.length ? Math.round((completed / intents.length) * 100) : 0,
    };
  }

  providerSuccessRates() {
    const out = {};
    for (const name of this.platform.payments.providers.keys()) {
      const ok = this.counters.get(`payments.completed.${name}`) || 0;
      const failed = this.counters.get(`payments.failed.${name}`) || 0;
      out[name] = {
        completed: ok,
        failed,
        success_pct: ok + failed ? Math.round((ok / (ok + failed)) * 100) : null,
      };
    }
    return out;
  }

  escrowCompletion() {
    const campaigns = this.platform.kgetsi.campaigns.find();
    const byState = {};
    for (const campaign of campaigns) byState[campaign.state] = (byState[campaign.state] || 0) + 1;
    return {
      campaigns: campaigns.length,
      by_state: byState,
      completion_pct: campaigns.length
        ? Math.round(((byState.closed || 0) / campaigns.length) * 100)
        : 0,
    };
  }

  tourism() {
    const bookings = this.platform.loeto.bookings.find();
    const byState = {};
    for (const booking of bookings) byState[booking.state] = (byState[booking.state] || 0) + 1;
    return { bookings: bookings.length, by_state: byState };
  }

  topSearchTerms(limit = 10) {
    return [...this.searchTerms.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([term, count]) => ({ term, count }));
  }

  /** Everything the analytics dashboard renders, in one call. */
  dashboard() {
    const today = this.clock.nowIso().slice(0, 10);
    return {
      generated_at: this.clock.nowIso(),
      activity: this.activity(),
      feature_usage_today: this.featureUsage(today),
      verification_conversion: this.verificationConversion(),
      payment_conversion: this.paymentConversion(),
      provider_success_rates: this.providerSuccessRates(),
      escrow_completion: this.escrowCompletion(),
      tourism: this.tourism(),
      heritage: {
        published_today: this._day(today).events.get('heritage.published') || 0,
        validated_today: this._day(today).events.get('heritage.validated') || 0,
        total: this.platform.heritage.items.count(),
      },
      offline: {
        sync_batches_today: this._day(today).events.get('offline.sync_batch') || 0,
        letsema_joins_via_ussd_sms:
          this._day(today).events.get('kgotla.letsema_joined.offline_channel') || 0,
        outbox_mutations_applied: this.platform.sync.applied.size,
      },
      search: {
        queries_today: this._day(today).events.get('search.query') || 0,
        top_terms: this.topSearchTerms(),
      },
      notifications: {
        dispatched_today: this._day(today).events.get('notifications.dispatched') || 0,
        delivery: this.platform.notifications.deliveryStats(),
      },
    };
  }

  /** Per-pilot usage for pilot reports: aggregates over enrolled wards. */
  pilotUsage(wardRefs) {
    const wardSet = new Set(wardRefs);
    const residents = this.platform.identity.users.find((u) => wardSet.has(u.ward_ref));
    const anonSet = new Set(residents.map((u) => AnalyticsService.anon(u.id)));
    let activeToday = 0;
    for (const anon of this._day().users) if (anonSet.has(anon)) activeToday += 1;
    return {
      residents: residents.length,
      active_today: activeToday,
      letsema_joins:
        this.counters.get('kgotla.letsema_joined') ||
        this._sumEvent('kgotla.letsema_joined'),
    };
  }

  _sumEvent(event) {
    let total = 0;
    for (const day of this.days.values()) total += day.events.get(event) || 0;
    return total;
  }
}

module.exports = { AnalyticsService };
