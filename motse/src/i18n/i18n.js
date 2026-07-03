'use strict';

/**
 * Localization (Phase 3, WS13). Setswana-first, English fallback —
 * per-morafe language packs are the doc's aspiration (§4). Message
 * catalogs are plain data so translators (not engineers) extend them.
 * The notification service resolves keys through here so civic messages
 * reach people in their language.
 */
const CATALOGS = {
  en: {
    'notify.payout_delivered': 'Payout delivered',
    'notify.payment_completed': 'Payment {type} completed',
    'notify.payment_failed': 'Payment failed',
    'notify.new_notice': 'New ward notice',
    'notify.civic_alert': 'Civic alert',
    'notify.approval_needed': 'Approval needed: {name}',
    'greeting.hello': 'Hello',
    'greeting.thanks': 'Thank you',
  },
  tn: {
    'notify.payout_delivered': 'Madi a rometswe',
    'notify.payment_completed': 'Tuelo {type} e feditswe',
    'notify.payment_failed': 'Tuelo e paletswe',
    'notify.new_notice': 'Kitsiso e ntšha ya kgotla',
    'notify.civic_alert': 'Tlhagiso ya setšhaba',
    'notify.approval_needed': 'Go tlhokega tetla: {name}',
    'greeting.hello': 'Dumela',
    'greeting.thanks': 'Ke a leboga',
  },
};

const DEFAULT_LOCALE = 'tn'; // Setswana-first

class I18n {
  constructor(catalogs = CATALOGS) {
    this.catalogs = { ...catalogs };
  }

  /** Register or extend a per-morafe/language pack at runtime. */
  addPack(locale, messages) {
    this.catalogs[locale] = { ...(this.catalogs[locale] || {}), ...messages };
  }

  locales() {
    return Object.keys(this.catalogs);
  }

  /**
   * Resolve a message key for a locale with interpolation. Falls back to
   * English, then to the key itself — a missing translation never breaks
   * a civic message.
   */
  t(key, { locale = DEFAULT_LOCALE, params = {} } = {}) {
    const catalog = this.catalogs[locale] || this.catalogs.en;
    let template = catalog[key];
    if (template === undefined) template = (this.catalogs.en || {})[key];
    if (template === undefined) return key;
    return template.replace(/\{(\w+)\}/g, (_, name) => (params[name] !== undefined ? params[name] : `{${name}}`));
  }

  /** Pick a locale from a user's declared languages (§4 language packs). */
  localeFor(user) {
    if (user && Array.isArray(user.langs)) {
      for (const lang of user.langs) {
        if (this.catalogs[lang]) return lang;
      }
    }
    return DEFAULT_LOCALE;
  }
}

module.exports = { I18n, CATALOGS, DEFAULT_LOCALE };
