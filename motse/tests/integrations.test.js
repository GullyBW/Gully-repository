'use strict';

const { createPlatform } = require('../src/container');
const { world } = require('./helpers');

describe('External integrations (WS9) — interfaces + sandbox providers', () => {
  test('the registry enforces known kinds and describes modes', () => {
    const w = world();
    const described = w.p.integrations.describe();
    expect(described.map((d) => d.kind).sort()).toEqual(
      ['bank', 'calendar', 'email', 'gis', 'gov_identity']
    );
    expect(() => w.p.integrations.register('fax', {})).toThrow(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    );
    expect(() => w.p.integrations.get('whatsapp')).toThrow(
      expect.objectContaining({ code: 'NOT_FOUND' }) // env-gated, off by default
    );
  });

  test('bank: link → transfer → statement, account numbers masked', () => {
    const w = world();
    const bank = w.p.integrations.get('bank');
    const link = bank.linkAccount({ ownerRef: w.kabo.id, bank: 'FNBB', accountNo: '62012345678' });
    expect(link.account_no_masked).toBe('***5678');
    const transfer = bank.transfer({ linkId: link.id, amountMinor: 5000, reference: 'rent' });
    expect(transfer.state).toBe('accepted');
    expect(bank.statement(w.p.clock.nowIso())).toHaveLength(1);
  });

  test('government identity: format validation + deterministic verification', () => {
    const w = world();
    const gov = w.p.integrations.get('gov_identity');
    expect(gov.verifyNationalId({ omang: '12345', fullName: 'X', dob: '1990-01-01' })).toMatchObject({
      verified: false, reason: 'OMANG_FORMAT_INVALID',
    });
    const valid = gov.verifyNationalId({ omang: '123456784', fullName: 'Kabo M', dob: '1990-01-01' }); // digit sum 40 — even
    expect(valid.verified).toBe(true);
    expect(valid.reference).toHaveLength(16);
    expect(
      gov.verifyNationalId({ omang: '123456789', fullName: 'X', dob: 'y' }).verified
    ).toBe(false); // parity rule
  });

  test('GIS: gazetteer geocoding and haversine distances', () => {
    const w = world();
    const gis = w.p.integrations.get('gis');
    const maun = gis.geocode('Maun');
    expect(maun.found).toBe(true);
    const gabs = gis.geocode('gaborone');
    const km = gis.distanceKm(maun.geo, gabs.geo);
    expect(km).toBeGreaterThan(500);
    expect(km).toBeLessThan(800);
    expect(gis.geocode('atlantis').found).toBe(false);
    expect(gis.staticMapUrl(maun.geo)).toContain('lat=');
  });

  test('email rides the notification service through the integration bridge', () => {
    const w = world();
    w.p.notifications.setPreference(w.kabo.id, 'payments', { email: true, push: false });
    w.p.notifications.notify(w.kabo.id, { category: 'payments', title: 'Receipt', body: 'BWP 10' });
    const emailProvider = w.p.integrations.get('email');
    expect(emailProvider.sent).toHaveLength(1);
    expect(emailProvider.sent[0].subject).toBe('Receipt');
  });

  test('WhatsApp Business is env-gated and delivers templates when enabled', () => {
    process.env.MOTSE_WHATSAPP_TOKEN = 'sandbox-token';
    try {
      const p = createPlatform();
      const user = p.identity.registerAnonymous('wa-dev');
      p.notifications.setPreference(user.id, 'payments', { whatsapp: true, push: false });
      p.notifications.notify(user.id, { category: 'payments', title: 'Pego', body: 'BWP 5' });
      const wa = p.integrations.get('whatsapp');
      expect(wa.sent).toHaveLength(1);
      expect(wa.sent[0].template).toBe('motse_notify');
      const stats = p.notifications.deliveryStats();
      expect(stats.by_channel.whatsapp.sent).toBe(1);
    } finally {
      delete process.env.MOTSE_WHATSAPP_TOKEN;
    }
  });

  test('calendar: RFC-5545 ICS events, escaped and complete', () => {
    const w = world();
    const calendar = w.p.integrations.get('calendar');
    const { ics, uid } = calendar.createEvent({
      title: 'Loeto: Tsodilo walk, day 1',
      start: '2026-08-01T08:00:00.000Z',
      end: '2026-08-01T16:00:00.000Z',
      location: 'Tsodilo Hills',
      description: 'Meet the guide; bring water',
    });
    expect(uid).toBeTruthy();
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Loeto: Tsodilo walk\\, day 1'); // comma escaped
    expect(ics).toContain('DTSTART:20260801T080000Z');
    expect(ics).toContain('END:VEVENT');
  });
});
