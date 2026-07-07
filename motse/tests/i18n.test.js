'use strict';

const { world } = require('./helpers');
const { I18n } = require('../src/i18n/i18n');

describe('Localization (WS13)', () => {
  test('Setswana-first with English fallback and interpolation', () => {
    const i18n = new I18n();
    expect(i18n.t('notify.payout_delivered')).toBe('Madi a rometswe'); // default tn
    expect(i18n.t('notify.payout_delivered', { locale: 'en' })).toBe('Payout delivered');
    expect(i18n.t('notify.payment_completed', { locale: 'tn', params: { type: 'collection' } }))
      .toBe('Tuelo collection e feditswe');
    // Unknown key falls back to the key itself, never throws.
    expect(i18n.t('nonexistent.key')).toBe('nonexistent.key');
    // Missing tn message falls back to English.
    i18n.addPack('en', { 'only.en': 'English only' });
    expect(i18n.t('only.en', { locale: 'tn' })).toBe('English only');
  });

  test('per-morafe/language packs extend at runtime; localeFor reads user langs', () => {
    const i18n = new I18n();
    i18n.addPack('ik', { 'greeting.hello': 'Mabakhulu' }); // Ikalanga pack
    expect(i18n.locales()).toEqual(expect.arrayContaining(['en', 'tn', 'ik']));
    expect(i18n.localeFor({ langs: ['ik', 'tn'] })).toBe('ik');
    expect(i18n.localeFor({ langs: ['zz'] })).toBe('tn'); // unknown → default
    expect(i18n.localeFor(null)).toBe('tn');
  });

  test('notifications localize titleKey into the recipient language (backward compatible)', () => {
    const w = world();
    // mma declares Setswana; a literal-title notification is unaffected.
    w.p.notifications.notify(w.mma.id, { category: 'payments', title: 'Literal title', body: null });
    expect(w.p.notifications.inboxFor(w.mma.id)[0].title).toBe('Literal title');
    // A keyed notification renders in Setswana.
    w.p.notifications.notify(w.mma.id, {
      category: 'payments', titleKey: 'notify.payout_delivered', body: null,
    });
    const localized = w.p.notifications.inboxFor(w.mma.id).find((n) => n.title === 'Madi a rometswe');
    expect(localized).toBeTruthy();
  });
});
