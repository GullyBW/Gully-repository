'use strict';

/**
 * Phase 5 (WS21) — QR Code Platform. Signed, time-limited, revocable QR
 * codes as a reusable platform capability across payments, identity,
 * tourism, heritage, governance, trusts, learning and the wallet, with
 * tamper detection, replay protection, permission validation, offline
 * verification and full audit + fraud + analytics + event instrumentation.
 */
const { world } = require('./helpers');
const { QrService } = require('../src/qr/qr.service');

function merchant(p) {
  return p.ledger.openAccount('merchant:qr', 'community_trust').id;
}

function expectErr(fn, code) {
  let e;
  try { fn(); } catch (caught) { e = caught; }
  expect(e).toBeDefined();
  if (code) expect(e.code).toBe(code);
  return e;
}

describe('QR generation & decoding', () => {
  test('generates a signed token for any supported kind; validates inputs', () => {
    const w = world();
    for (const kind of QrService.kinds()) {
      const out = w.p.qr.generate('u:admin', { kind, subjectRef: 'x' });
      expect(out.token).toMatch(/^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/);
      expect(out.kind).toBe(kind);
    }
    expectErr(() => w.p.qr.generate('u:admin', { kind: 'nonsense' }), 'INVALID_ARGUMENT');
    expectErr(() => w.p.qr.generate('u:admin', { kind: 'payment', amountMinor: -5 }), 'INVALID_ARGUMENT');
  });

  test('decode exposes structure without trusting it; rejects malformed tokens', () => {
    const w = world();
    const { token } = w.p.qr.generate('u:admin', { kind: 'identity', subjectRef: 'u:bob', data: { role: 'volunteer' } });
    const decoded = w.p.qr.decode(token);
    expect(decoded).toMatchObject({ kind: 'identity', subject_ref: 'u:bob' });
    expect(decoded.data).toEqual({ role: 'volunteer' });
    expectErr(() => w.p.qr.decode('not-a-token'), 'INVALID_ARGUMENT');
  });
});

describe('QR verification & security', () => {
  test('a valid QR verifies and records the scan', () => {
    const w = world();
    const { qr_id, token } = w.p.qr.generate('u:admin', { kind: 'tourism', ref: 'booking:1' });
    const v = w.p.qr.verify(token, { scannerRef: 'u:guide' });
    expect(v).toMatchObject({ valid: true, qr_id, kind: 'tourism', ref: 'booking:1' });
    expect(w.p.qr.scanHistory(qr_id)).toHaveLength(1);
  });

  test('tamper, expiry, revocation and single-use replay are all rejected', () => {
    const w = world();
    // Tamper.
    const a = w.p.qr.generate('u:admin', { kind: 'access' });
    expect(w.p.qr.verify(a.token.slice(0, -4) + 'dead').valid).toBe(false);
    expect(w.p.qr.verify(a.token.slice(0, -4) + 'dead').reason).toBe('bad_signature');
    // Expiry.
    const b = w.p.qr.generate('u:admin', { kind: 'access', expiresInMs: 1000 });
    w.p.clock.advance(2000);
    expect(w.p.qr.verify(b.token).reason).toBe('expired');
    // Revocation (idempotent).
    const c = w.p.qr.generate('u:admin', { kind: 'identity' });
    w.p.qr.revoke('u:admin', c.qr_id, 'lost');
    expect(w.p.qr.revoke('u:admin', c.qr_id).state).toBe('revoked'); // second revoke is a no-op
    expect(w.p.qr.verify(c.token).reason).toBe('revoked');
    // Single-use replay.
    const d = w.p.qr.generate('u:admin', { kind: 'access', singleUse: true });
    expect(w.p.qr.verify(d.token).valid).toBe(true);
    expect(w.p.qr.verify(d.token).reason).toBe('already_used');
  });

  test('unknown code, cross-tenant and amount-mismatch are rejected', () => {
    const w = world();
    const orphan = w.p.qr.generate('u:admin', { kind: 'access' });
    w.p.qr.codes.delete(orphan.qr_id); // valid signature, but no record
    expect(w.p.qr.verify(orphan.token).reason).toBe('unknown');

    const scoped = w.p.qr.generate('u:admin', { kind: 'identity', tenant: 'museum' });
    expect(w.p.qr.verify(scoped.token, { tenant: 'tourism_board' }).reason).toBe('cross_tenant');

    const pay = w.p.qr.generate('u:admin', { kind: 'payment', ref: merchant(w.p), amountMinor: 5000 });
    expect(w.p.qr.verify(pay.token, { amountMinor: 9999 }).reason).toBe('amount_mismatch');
  });

  test('restricted QRs disclose restricted data only to authorized scanners', () => {
    const w = world();
    // requiredLevel: mma is L2, kabo is L1.
    const lvl = w.p.qr.generate('u:admin', {
      kind: 'heritage', visibility: 'restricted', requiredLevel: 'L2',
      data: { title: 'Site' }, restricted: { sacred_notes: 'elders only' },
    });
    expect(w.p.qr.verify(lvl.token, { scannerRef: w.mma.id }).restricted).toEqual({ sacred_notes: 'elders only' });
    expect(w.p.qr.verify(lvl.token, { scannerRef: w.kabo.id }).restricted).toBeNull();
    expect(w.p.qr.verify(lvl.token).restricted).toBeNull(); // anonymous

    // requiredRole: platform_admin.
    const role = w.p.qr.generate('u:admin', { kind: 'governance', visibility: 'restricted', requiredRole: 'platform_admin', restricted: { minutes: 'x' } });
    expect(w.p.qr.verify(role.token, { scannerRef: w.kabo.id }).authorized).toBe(false);
    w.p.identity.grantInstitutional(w.kabo.id, { institution: 'Ops' }, 'system:bootstrap');
    w.p.identity.grantRole(w.kabo.id, 'platform_admin', 'platform', 'system:bootstrap');
    expect(w.p.qr.verify(role.token, { scannerRef: w.kabo.id }).authorized).toBe(true);
  });

  test('offline verification checks signature + expiry without server state', () => {
    const w = world();
    const secret = w.p.secrets.current('qr:signing').value;
    const { token } = w.p.qr.generate('u:admin', { kind: 'identity', subjectRef: 'u:bob' });
    expect(QrService.verifyOffline(secret, token, w.p.clock.nowMs())).toMatchObject({ valid: true, kind: 'identity' });
    expect(QrService.verifyOffline(secret, 'bad').reason).toBe('malformed');
    expect(QrService.verifyOffline('wrong-secret', token).reason).toBe('bad_signature');
    const exp = w.p.qr.generate('u:admin', { kind: 'access', expiresInMs: 100 });
    expect(QrService.verifyOffline(secret, exp.token, w.p.clock.nowMs() + 1000).reason).toBe('expired');
  });
});

describe('QR payments (WS21)', () => {
  test('pay by scanning a payment QR — card rail', () => {
    const w = world();
    const dest = merchant(w.p);
    const card = w.p.cards.saveCard(w.kabo.id, { hostedFieldRef: 'hf', brand: 'visa', last4: '4242' });
    const { token } = w.p.qr.generate('u:merchant', { kind: 'payment', ref: dest, amountMinor: 12000, currency: 'BWP' });
    const intent = w.p.qr.payWithQr(w.kabo.id, token, { cardId: card.id });
    expect(intent.state).toBe('authorized');
    expect(intent.amount_minor).toBe(12000);
  });

  test('pay by scanning a payment QR — mobile-money rail', () => {
    const w = world();
    const dest = merchant(w.p);
    const { token } = w.p.qr.generate('u:merchant', { kind: 'payment', ref: dest, amountMinor: 3000, currency: 'BWP' });
    const out = w.p.qr.payWithQr(w.kabo.id, token, { provider: 'orange_money', msisdn: '+26771000002' });
    expect(out.state).toMatch(/pending/); // mobile-money collection awaits the operator webhook
    expect(out.provider).toBe('orange_money');
  });

  test('non-payment, amountless and revoked QRs cannot be paid', () => {
    const w = world();
    const id = w.p.qr.generate('u:admin', { kind: 'identity' });
    expectErr(() => w.p.qr.payWithQr(w.kabo.id, id.token, {}), 'INVALID_ARGUMENT');
    const dyn = w.p.qr.generate('u:admin', { kind: 'payment', ref: merchant(w.p) }); // no amount
    expectErr(() => w.p.qr.payWithQr(w.kabo.id, dyn.token, {}), 'INVALID_ARGUMENT');
    const noref = w.p.qr.generate('u:admin', { kind: 'payment', amountMinor: 100 }); // no dest
    expectErr(() => w.p.qr.payWithQr(w.kabo.id, noref.token, {}), 'INVALID_ARGUMENT');
    const rev = w.p.qr.generate('u:admin', { kind: 'payment', ref: merchant(w.p), amountMinor: 100 });
    w.p.qr.revoke('u:admin', rev.qr_id);
    expectErr(() => w.p.qr.payWithQr(w.kabo.id, rev.token, {}), 'STATE_CONFLICT');
  });
});

describe('QR administration & reporting', () => {
  test('list, get, report, scan history and bulk generation', () => {
    const w = world();
    w.p.qr.bulkGenerate('u:admin', [
      { kind: 'learning', ref: 'lesson:1' },
      { kind: 'learning', ref: 'lesson:2' },
      { kind: 'trust', ref: 'trust:1' },
    ]);
    expect(w.p.qr.list({ kind: 'learning' })).toHaveLength(2);
    const all = w.p.qr.list();
    expect(w.p.qr.get(all[0].qr_id).qr_id).toBe(all[0].qr_id);
    const report = w.p.qr.report();
    expect(report.total).toBeGreaterThanOrEqual(3);
    expect(report.by_kind.learning).toBe(2);
    expectErr(() => w.p.qr.get('qr_missing'), 'NOT_FOUND');
  });

  test('a scanned QR feeds the qr_activity projection and rejection reasons appear in the report', () => {
    const w = world();
    const good = w.p.qr.generate('u:admin', { kind: 'access' });
    w.p.qr.verify(good.token, { scannerRef: 'u:x' });
    w.p.qr.verify('garbage.sig'); // a rejected scan
    const report = w.p.qr.report();
    expect(report.valid_scans).toBeGreaterThanOrEqual(1);
    expect(report.rejected).toBeGreaterThanOrEqual(1);
    expect(report.rejection_reasons.bad_signature).toBeGreaterThanOrEqual(1);
    const proj = w.p.projections.read('qr_activity');
    expect(proj.generated).toBeGreaterThanOrEqual(1);
    expect(proj.scanned).toBeGreaterThanOrEqual(1);
  });
});

describe('QR fraud monitoring', () => {
  test('excessive scanning is blocked (velocity)', () => {
    const w = world();
    const reusable = w.p.qr.generate('u:admin', { kind: 'access' });
    let blocked = false;
    let valid = 0;
    for (let i = 0; i < 12; i += 1) {
      const v = w.p.qr.verify(reusable.token, { scannerRef: 'u:spammer' });
      if (v.valid) valid += 1;
      if (!v.valid && v.reason === 'fraud_block') blocked = true;
    }
    expect(valid).toBeGreaterThan(0);
    expect(blocked).toBe(true);
  });

  test('the qr_scan_velocity check grades review vs deny', () => {
    const w = world();
    const check = w.p.fraud.checks.get('qr_scan_velocity');
    const engine = { clock: w.p.clock, _history: [] };
    const push = (n) => { for (let i = 0; i < n; i += 1) engine._history.push({ actorRef: 'z', kind: 'qr_scan', at: w.p.clock.nowMs() }); };
    push(30);
    expect(check({ kind: 'qr_scan', actorRef: 'z' }, engine).action).toBe('deny');
    engine._history.length = 0; push(15);
    expect(check({ kind: 'qr_scan', actorRef: 'z' }, engine).action).toBe('review');
    engine._history.length = 0; push(2);
    expect(check({ kind: 'qr_scan', actorRef: 'z' }, engine)).toBeNull();
    expect(check({ kind: 'payment', actorRef: 'z' }, engine)).toBeNull();
    expect(check({ kind: 'qr_scan', actorRef: 'anonymous' }, engine)).toBeNull();
    expect(check({ kind: 'qr_scan' }, engine)).toBeNull();
  });
});
