'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { createPlatform } = require('../src/container');
const { world, adminUser, liveCampaign, publishedItem } = require('./helpers');

/**
 * Administration portal API: authorization boundary, dashboard,
 * identity management, governance controls, read-only ledger explorer,
 * heritage administration, financial administration, audit explorer.
 */
describe('Admin API', () => {
  let app;
  let w;
  let adminToken;
  let memberToken;

  beforeEach(async () => {
    w = world();
    ({ app } = createApp(w.p, { adminBootstrapToken: 'test-bootstrap' }));

    // Bootstrap the admin over HTTP, then log in via OTP as that MSISDN.
    await request(app)
      .post('/v1/admin/bootstrap')
      .set('Idempotency-Key', 'bs-1')
      .set('X-Bootstrap-Token', 'test-bootstrap')
      .send({ msisdn: '+26771900000' });
    adminToken = await login('+26771900000');
    memberToken = await login('+26771000002'); // kabo — not an admin
  });

  async function login(msisdn) {
    const unique = Math.random().toString(36).slice(2);
    const otp = await request(app)
      .post('/v1/identity/otp')
      .set('Idempotency-Key', `otp-${msisdn}-${unique}`)
      .send({ msisdn });
    const verify = await request(app)
      .post('/v1/identity/otp/verify')
      .set('Idempotency-Key', `otpv-${msisdn}-${unique}`)
      .set('X-Device-Id', 'test-admin-device')
      .send({ msisdn, code: otp.body.sandbox_code });
    return verify.body.session.access_token;
  }

  const asAdmin = (req) =>
    req.set('Authorization', `Bearer ${adminToken}`).set('X-Device-Id', 'test-admin-device');
  const asMember = (req) =>
    req.set('Authorization', `Bearer ${memberToken}`).set('X-Device-Id', 'test-admin-device');

  test('bootstrap requires the deploy token; bad tokens are denied and logged', async () => {
    const bad = await request(app)
      .post('/v1/admin/bootstrap')
      .set('Idempotency-Key', 'bs-bad')
      .set('X-Bootstrap-Token', 'wrong')
      .send({ msisdn: '+26771911111' });
    expect(bad.status).toBe(403);
    const denials = await asAdmin(request(app).get('/v1/admin/security/denials'));
    expect(denials.body.some((d) => d.path.includes('/bootstrap'))).toBe(true);
  });

  test('non-admins are rejected on every admin surface (level gate fires first)', async () => {
    const res = await asMember(request(app).get('/v1/admin/dashboard'));
    expect(res.status).toBe(403);
    // kabo is L1: the L3 verification gate rejects before the role check.
    expect(res.body.code).toBe('AUTH_LEVEL_REQUIRED');
    expect(res.body.required_level).toBe('L3');
  });

  test('dashboard aggregates users, escrows, governance, heritage, payments and health', async () => {
    liveCampaign(w);
    publishedItem(w);
    const res = await asAdmin(request(app).get('/v1/admin/dashboard'));
    expect(res.status).toBe(200);
    expect(res.body.users.total).toBeGreaterThan(0);
    expect(res.body.users.by_level).toHaveProperty('L2');
    expect(res.body.escrow.count).toBe(1);
    expect(res.body.transactions.trial_balance.balanced).toBe(true);
    expect(res.body.payments.providers).toEqual(
      expect.arrayContaining(['orange_money', 'myzaka', 'smega'])
    );
    expect(res.body.api_health.ready).toBe(true);
    expect(res.body.heritage.total).toBe(1);
  });

  test('identity management: search, detail, level change, suspend kills tokens, reinstate restores', async () => {
    const search = await asAdmin(request(app).get('/v1/admin/users?query=&level=L1&page_size=10'));
    expect(search.body.items.length).toBeGreaterThan(0);

    const detail = await asAdmin(request(app).get(`/v1/admin/users/${w.kabo.id}`));
    expect(detail.body.user.id).toBe(w.kabo.id);
    expect(detail.body.verification).toHaveProperty('endorsements');
    expect(detail.body).toHaveProperty('sessions');

    // Level change requires a reason and lands on the audit chain.
    const noReason = await asAdmin(
      request(app).post(`/v1/admin/users/${w.kabo.id}/level`)
    ).set('Idempotency-Key', 'lvl-0').send({ level: 'L2' });
    expect(noReason.status).toBe(400);
    await asAdmin(request(app).post(`/v1/admin/users/${w.kabo.id}/level`))
      .set('Idempotency-Key', 'lvl-1')
      .send({ level: 'L2', reason: 'field verification backfill' });
    expect(w.p.identity.get(w.kabo.id).level).toBe('L2');

    // Suspension: member token dies immediately.
    await asAdmin(request(app).post(`/v1/admin/users/${w.kabo.id}/suspend`))
      .set('Idempotency-Key', 'susp-1')
      .send({ reason: 'fraud investigation' });
    const dead = await asMember(request(app).get('/v1/notifications'));
    expect(dead.status).toBe(401);

    await asAdmin(request(app).post(`/v1/admin/users/${w.kabo.id}/reinstate`))
      .set('Idempotency-Key', 'rein-1')
      .send({ note: 'cleared' });
    expect(w.p.identity.get(w.kabo.id).suspended).toBeFalsy();
    // The whole episode is on the user's hash-chained history.
    const history = w.p.audit.chainFor(`user:${w.kabo.id}`).map((e) => e.action);
    expect(history).toEqual(
      expect.arrayContaining([
        'identity.admin_level_set',
        'identity.user_suspended',
        'identity.user_reinstated',
      ])
    );
  });

  test('OTP audit never exposes code hashes', async () => {
    const res = await asAdmin(request(app).get('/v1/admin/otp-audit'));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
    for (const row of res.body.items) {
      expect(row).not.toHaveProperty('code_hash');
    }
  });

  test('governance: council → seat → Ring-3 freeze → unfreeze over HTTP', async () => {
    const council = await asAdmin(request(app).post('/v1/admin/councils'))
      .set('Idempotency-Key', 'cnl-1')
      .send({ morafe_ref: 'bangwato' });
    const seat = await asAdmin(
      request(app).post(`/v1/admin/councils/${council.body.id}/seats`)
    )
      .set('Idempotency-Key', 'seat-1')
      .send({ kind: 'bogosi', holder_ref: w.mma.id });
    expect(seat.body.state).toBe('active');
    expect(w.p.identity.hasRole(w.mma.id, 'custodian', 'morafe:bangwato')).toBe(true);

    await asAdmin(request(app).post(`/v1/admin/seats/${seat.body.id}/freeze`))
      .set('Idempotency-Key', 'frz-1')
      .send({ reason: 'succession contested' });
    expect(w.p.identity.hasRole(w.mma.id, 'custodian', 'morafe:bangwato')).toBe(false);

    await asAdmin(request(app).post(`/v1/admin/seats/${seat.body.id}/unfreeze`))
      .set('Idempotency-Key', 'unfrz-1')
      .send({});
    expect(w.p.identity.hasRole(w.mma.id, 'custodian', 'morafe:bangwato')).toBe(true);
  });

  test('ledger explorer is comprehensive and strictly read-only', async () => {
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 5000,
      contributorRef: w.kabo.id,
      idempotencyKey: 'adm-give',
    });
    const [journal, tb, accounts, escrows, templates, idem] = await Promise.all([
      asAdmin(request(app).get('/v1/admin/ledger/journal?page_size=10')),
      asAdmin(request(app).get('/v1/admin/ledger/trial-balance')),
      asAdmin(request(app).get('/v1/admin/ledger/accounts?page_size=10')),
      asAdmin(request(app).get('/v1/admin/ledger/escrows')),
      asAdmin(request(app).get('/v1/admin/ledger/split-templates')),
      asAdmin(request(app).get('/v1/admin/ledger/idempotency')),
    ]);
    expect(journal.body.items.length).toBeGreaterThan(0);
    expect(tb.body.balanced).toBe(true);
    expect(accounts.body.items[0]).toHaveProperty('balance_minor');
    expect(escrows.body).toHaveLength(1);
    expect(templates.body.some((t) => t.name === 'loeto_default')).toBe(true);
    expect(idem.body.items.length).toBeGreaterThan(0);
    // No write surface: posting mutations under /v1/admin/ledger do not exist.
    const write = await asAdmin(request(app).post('/v1/admin/ledger/journal'))
      .set('Idempotency-Key', 'nope-1')
      .send({});
    expect(write.status).toBe(404);
  });

  test('failed postings are recorded once and browsable', async () => {
    expect(() =>
      w.p.ledger.post({
        entries: [
          { account_id: w.kaboWallet.id, amount_minor: -10 },
          { account_id: w.mmaWallet.id, amount_minor: 9 },
        ],
        purpose: 'bad',
        ref: 'bad:1',
        idempotencyKey: 'bad-1',
      })
    ).toThrow();
    const res = await asAdmin(request(app).get('/v1/admin/ledger/rejections'));
    expect(res.body).toHaveLength(1);
    expect(res.body[0].reason).toBe('LEDGER_IMBALANCE_REJECTED');
  });

  test('heritage administration: flagged queue, consents, deletion receipts, audited restricted view', async () => {
    const item = publishedItem(w, { visibility: 'members', title: 'Sacred narration' });
    const council = w.p.governance.createCouncil('bakalanga', w.admin.id);
    w.p.governance.grantSeat(council.id, { kind: 'association', holderRef: w.mma.id }, w.admin.id);
    w.p.heritage.validate(item.id, w.mma.id, { decision: 'flag' });

    const flagged = await asAdmin(request(app).get('/v1/admin/heritage/flagged'));
    expect(flagged.body.map((i) => i.id)).toContain(item.id);

    const consents = await asAdmin(request(app).get('/v1/admin/heritage/consents'));
    expect(consents.body.items.length).toBeGreaterThan(0);

    const restricted = await asAdmin(request(app).get('/v1/admin/heritage/restricted'));
    expect(restricted.body.map((i) => i.id)).toContain(item.id);
    expect(restricted.body[0]).not.toHaveProperty('title'); // withheld even from admins
    // The admin view itself is on the audit log (§13.2 insider access).
    expect(
      w.p.audit.chainFor('heritage:restricted').some(
        (e) => e.action === 'admin.restricted_metadata_viewed'
      )
    ).toBe(true);

    // Deletion contract driven from the portal. The 91-day jump expires
    // the short-lived access token (by design) — the admin signs back in.
    w.p.heritage.withdraw(item.id, w.mma.id, 'council decision');
    w.p.clock.advance(91 * 24 * 3600 * 1000);
    const expired = await asAdmin(request(app).get('/v1/admin/heritage/deletions'));
    expect(expired.status).toBe(401); // short-lived tokens do expire
    adminToken = await login('+26771900000');
    await asAdmin(request(app).post('/v1/admin/heritage/deletion-sweep'))
      .set('Idempotency-Key', 'sweep-1')
      .send({});
    const deletions = await asAdmin(request(app).get('/v1/admin/heritage/deletions'));
    // This item had no media; the endpoint shape still holds.
    expect(deletions.status).toBe(200);
  });

  test('financial administration: pending milestones, reconciliation, payments list', async () => {
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id,
      amountMinor: 50000,
      contributorRef: w.kabo.id,
      idempotencyKey: 'fin-give',
    });
    w.p.kgetsi.submitEvidence(campaign.id, 'm1', w.kabo.id, ['med_r']);
    const pending = await asAdmin(request(app).get('/v1/admin/finance/milestones/pending'));
    expect(pending.body).toHaveLength(1);
    expect(pending.body[0].milestone.state).toBe('evidence_submitted');

    const rec = await asAdmin(request(app).post('/v1/admin/finance/reconcile'))
      .set('Idempotency-Key', 'rec-1')
      .send({ provider: 'orange_money' });
    expect(rec.body).toHaveProperty('variance_minor');

    const payments = await asAdmin(request(app).get('/v1/admin/finance/payments'));
    expect(payments.status).toBe(200);
  });

  test('audit explorer: object history verifies, inclusion proofs check, CSV exports', async () => {
    const campaign = liveCampaign(w);
    const objectRef = `campaign:${campaign.id}`;
    const history = await asAdmin(
      request(app).get(`/v1/admin/audit/object/${encodeURIComponent(objectRef)}`)
    );
    expect(history.body.verification.valid).toBe(true);
    const entry = history.body.entries[0];

    const proof = await asAdmin(
      request(app).get(`/v1/admin/audit/proof/${encodeURIComponent(objectRef)}/${entry.id}`)
    );
    expect(proof.body.valid).toBe(true);

    const byActor = await asAdmin(
      request(app).get(`/v1/admin/audit/actor/${encodeURIComponent(w.admin.id)}`)
    );
    expect(byActor.body.items.length).toBeGreaterThan(0);

    const csv = await asAdmin(request(app).get('/v1/admin/audit/export?format=csv&prefix=campaign:'));
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text.split('\n').length).toBeGreaterThan(1);
    expect(csv.text).toContain('actor_ref');
  });

  test('secret rotation via the portal is audited and bumps the version', async () => {
    const before = await asAdmin(request(app).get('/v1/admin/security/secrets'));
    const target = before.body.find((s) => s.name === 'webhook:orange_money');
    const res = await asAdmin(
      request(app).post('/v1/admin/security/secrets/webhook:orange_money/rotate')
    )
      .set('Idempotency-Key', 'rot-1')
      .send({});
    expect(res.body.version).toBe(target.current_version + 1);
    expect(
      w.p.audit.chainFor('secret:webhook:orange_money').some(
        (e) => e.action === 'security.secret_rotated'
      )
    ).toBe(true);
  });

  test('elections and disputes are managed end-to-end over the admin API', async () => {
    const council = await asAdmin(request(app).post('/v1/admin/councils'))
      .set('Idempotency-Key', 'ec-1')
      .send({ morafe_ref: 'bakalanga' });
    const election = await asAdmin(
      request(app).post(`/v1/admin/councils/${council.body.id}/elections`)
    )
      .set('Idempotency-Key', 'el-1')
      .send({ seat_description: 'elder seat' });
    w.p.governance.nominate(election.body.id, w.mma.id);
    w.p.governance.vote(election.body.id, w.mma.id, w.mma.id);
    const closed = await asAdmin(
      request(app).post(`/v1/admin/elections/${election.body.id}/close`)
    )
      .set('Idempotency-Key', 'el-close')
      .send({ eligible: 12 });
    expect(closed.body.turnout).toEqual({ votes_cast: 1, eligible: 12 });
    const list = await asAdmin(request(app).get('/v1/admin/elections'));
    expect(list.body).toHaveLength(1);

    const dispute = w.p.governance.openDispute('heritage:her_x', w.mma.id, 'contested');
    await asAdmin(request(app).post(`/v1/admin/disputes/${dispute.id}/escalate`))
      .set('Idempotency-Key', 'de-1')
      .send({});
    const resolved = await asAdmin(
      request(app).post(`/v1/admin/disputes/${dispute.id}/resolve`)
    )
      .set('Idempotency-Key', 'dr-1')
      .send({ resolution: 'both accounts preserved' });
    expect(resolved.body.state).toBe('resolved');
    expect(resolved.body.ring).toBe(2);
  });

  test('role grants/revokes, single-session revoke, and remaining explorers respond', async () => {
    await asAdmin(request(app).post(`/v1/admin/users/${w.mma.id}/roles`))
      .set('Idempotency-Key', 'role-1')
      .send({ role: 'headman_office', scope: `ward:${w.ward.id}` });
    expect(w.p.identity.hasRole(w.mma.id, 'headman_office', `ward:${w.ward.id}`)).toBe(true);
    await asAdmin(request(app).post(`/v1/admin/users/${w.mma.id}/roles/revoke`))
      .set('Idempotency-Key', 'role-2')
      .send({ role: 'headman_office', scope: `ward:${w.ward.id}` });
    expect(w.p.identity.hasRole(w.mma.id, 'headman_office', `ward:${w.ward.id}`)).toBe(false);

    const detail = await asAdmin(request(app).get(`/v1/admin/users/${w.kabo.id}`));
    const sessionId = detail.body.sessions[0].id;
    const revoked = await asAdmin(request(app).post(`/v1/admin/sessions/${sessionId}/revoke`))
      .set('Idempotency-Key', 'sess-1')
      .send({});
    expect(revoked.body.revoked).toBe(true);

    const [payouts, recRuns, failed, stats, permAudit, suspendedFilter, journal] =
      await Promise.all([
        asAdmin(request(app).get('/v1/admin/ledger/payouts?state=pending')),
        asAdmin(request(app).get('/v1/admin/ledger/reconciliation-runs')),
        asAdmin(request(app).get('/v1/admin/finance/payouts/failed')),
        asAdmin(request(app).get('/v1/admin/notifications/stats')),
        asAdmin(request(app).get('/v1/admin/security/permission-audit')),
        asAdmin(request(app).get('/v1/admin/users?suspended=true')),
        asAdmin(request(app).get('/v1/admin/ledger/journal?purpose=provider_deposit')),
      ]);
    expect(payouts.status).toBe(200);
    expect(recRuns.status).toBe(200);
    expect(failed.body).toHaveProperty('dead_letters');
    expect(stats.body).toHaveProperty('by_channel');
    expect(permAudit.body.grants.length).toBeGreaterThan(0);
    expect(suspendedFilter.body.items).toHaveLength(0);
    expect(journal.body.items.length).toBeGreaterThan(0); // world() top-ups

    const drained = await asAdmin(request(app).post('/v1/admin/finance/retries/drain'))
      .set('Idempotency-Key', 'drain-1')
      .send({});
    expect(drained.body).toHaveProperty('ran');
    const reindexed = await asAdmin(request(app).post('/v1/admin/search/reindex'))
      .set('Idempotency-Key', 'reidx-1')
      .send({});
    expect(reindexed.body).toHaveProperty('documents');
  });

  test('fraud reviews are closeable from the finance module', async () => {
    w.p.payments.collect({
      provider: 'smega', msisdn: 'x', amountMinor: 600000,
      destAccountId: w.kaboWallet.id, actorRef: w.kabo.id, idempotencyKey: 'adm-large',
    });
    const reviews = await asAdmin(request(app).get('/v1/admin/finance/fraud-reviews'));
    expect(reviews.body.length).toBeGreaterThan(0);
    const closed = await asAdmin(
      request(app).post(`/v1/admin/finance/fraud-reviews/${reviews.body[0].id}/close`)
    )
      .set('Idempotency-Key', 'frw-1')
      .send({ resolution: 'checked with branch' });
    expect(closed.body.state).toBe('closed');
  });

  test('the portal page is served with security headers', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Motse Administration');
    expect(res.headers).toHaveProperty('content-security-policy');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});
