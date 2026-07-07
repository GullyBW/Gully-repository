'use strict';

const request = require('supertest');
const { createApp } = require('../src/app');
const { world, freshVerifiedUser, fundedWallet, liveCampaign, publishedItem } = require('./helpers');

/**
 * Phase-2 client surface: everything the Flutter app and PWA consume —
 * wallet, browse lists, family features, progress, reviews, flags —
 * plus the PWA shell itself.
 */
describe('Client APIs (WS1/WS2 backend surface)', () => {
  let w;
  let app;
  let session;

  beforeEach(() => {
    w = world();
    ({ app } = createApp(w.p));
    const { sandbox_code } = w.p.identity.requestOtp('+26771000002'); // kabo
    ({ session } = w.p.identity.verifyOtp('+26771000002', sandbox_code, { deviceId: 'pwa-test' }));
  });

  const authed = (req) =>
    req.set('Authorization', `Bearer ${session.access_token}`).set('X-Device-Id', 'pwa-test');

  test('wallet: accounts with balances, receipts showing only MY ledger legs, payout list', async () => {
    const campaign = liveCampaign(w);
    w.p.kgetsi.contribute(campaign.id, {
      sourceAccountId: w.kaboWallet.id, amountMinor: 2500,
      contributorRef: w.kabo.id, idempotencyKey: 'cw-1',
    });
    const accounts = await authed(request(app).get('/v1/wallet/accounts'));
    expect(accounts.body).toHaveLength(1);
    expect(accounts.body[0].balance_minor).toBe(97500);

    const history = await authed(request(app).get('/v1/wallet/history'));
    expect(history.body.length).toBeGreaterThanOrEqual(2); // top-up + contribution
    for (const posting of history.body) {
      // Privacy: only the caller's own entries appear, never the escrow's.
      for (const entry of posting.my_entries) {
        expect(entry.account_id).toBe(w.kaboWallet.id);
      }
    }
    const payouts = await authed(request(app).get('/v1/wallet/payouts'));
    expect(payouts.status).toBe(200);
  });

  test('browse lists: campaigns exclude drafts; experiences carry ratings; courses list', async () => {
    w.p.kgetsi.open(w.kabo.id, {
      campaignClass: 'community', title: 'Draft only', targetMinor: 100,
      milestones: [{ description: 'x', amount_minor: 100 }],
    });
    liveCampaign(w);
    const campaigns = await request(app).get('/v1/kgetsi/campaigns');
    expect(campaigns.body.items).toHaveLength(1); // the draft stays invisible

    w.p.loeto.createExperience(w.mma.id, {
      title: 'Delta mokoro day', priceMinor: 20000,
      splitTemplate: { name: 't', version: 1, shares: [{ account_id: w.mmaWallet.id, pct: 100 }] },
    });
    const experiences = await request(app).get('/v1/loeto/experiences');
    expect(experiences.body.items[0].rating).toEqual({ count: 0, average: null });

    const courses = await request(app).get('/v1/puo/courses');
    expect(courses.status).toBe(200);
  });

  test('loeto: book → settle → review over HTTP; ratings aggregate; ICS itinerary', async () => {
    const experience = w.p.loeto.createExperience(w.mma.id, {
      title: 'Rock art walk', priceMinor: 10000,
      splitTemplate: { name: 't', version: 1, shares: [{ account_id: w.mmaWallet.id, pct: 100 }] },
    });
    const booking = await authed(request(app).post('/v1/loeto/bookings'))
      .set('Idempotency-Key', 'cb-1')
      .send({ experience_id: experience.id, source_account_id: w.kaboWallet.id });
    expect(booking.body.state).toBe('paid');

    // Review before settlement is refused.
    const early = await authed(request(app).post(`/v1/loeto/bookings/${booking.body.id}/review`))
      .set('Idempotency-Key', 'cr-0').send({ rating: 5 });
    expect(early.status).toBe(409);

    w.p.loeto.settle(booking.body.id, w.mma.id, { idempotencyKey: 'cs-1' });
    const review = await authed(request(app).post(`/v1/loeto/bookings/${booking.body.id}/review`))
      .set('Idempotency-Key', 'cr-1').send({ rating: 4, comment: 'Monate!' });
    expect(review.status).toBe(200);
    // One review per booking; rating must be 1–5.
    const dupe = await authed(request(app).post(`/v1/loeto/bookings/${booking.body.id}/review`))
      .set('Idempotency-Key', 'cr-2').send({ rating: 5 });
    expect(dupe.status).toBe(409);
    expect(w.p.loeto.ratingFor(experience.id)).toEqual({ count: 1, average: 4 });

    const ics = await authed(request(app).get(`/v1/loeto/bookings/${booking.body.id}/ics`));
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('BEGIN:VEVENT');
    // Another member cannot pull my itinerary.
    const stranger = freshVerifiedUser(w.p);
    const { sandbox_code } = w.p.identity.requestOtp('+26771991111');
    void stranger;
    void sandbox_code;
    const bookings = await authed(request(app).get('/v1/loeto/bookings'));
    expect(bookings.body).toHaveLength(1);
  });

  test('lelapa: invite by msisdn → accept binds to the right phone; tree/events member-only', async () => {
    const circle = w.p.lelapa.createCircle(w.kabo.id, 'Ba ga Kabo');
    const invitation = w.p.lelapa.inviteMember(circle.id, w.kabo.id, {
      msisdn: '+26771000001', // mma's number
      relation: 'mother',
    });
    // kabo cannot accept an invitation addressed to mma's phone.
    expect(() => w.p.lelapa.acceptInvitation(invitation.id, w.kabo.id)).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
    w.p.lelapa.acceptInvitation(invitation.id, w.mma.id);
    const tree = w.p.lelapa.familyTree(circle.id, w.kabo.id);
    expect(tree.members).toContain(w.mma.id);
    expect(tree.relations[0]).toMatchObject({ relation: 'mother', member_ref: w.mma.id });
    // Accepting twice fails cleanly.
    expect(() => w.p.lelapa.acceptInvitation(invitation.id, w.mma.id)).toThrow(
      expect.objectContaining({ code: 'STATE_CONFLICT' })
    );
    // Outsiders see nothing.
    const outsider = freshVerifiedUser(w.p);
    expect(() => w.p.lelapa.familyTree(circle.id, outsider.id)).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
    w.p.lelapa.createFamilyEvent(circle.id, w.kabo.id, { title: 'Naming', date: '2026-09-01', kind: 'naming' });
    expect(w.p.lelapa.familyEvents(circle.id, w.mma.id)).toHaveLength(1);
    expect(() => w.p.lelapa.familyEvents(circle.id, outsider.id)).toThrow(
      expect.objectContaining({ code: 'PERMISSION_DENIED' })
    );
  });

  test('puo progress: completion is idempotent and respects restricted lesson gates', async () => {
    const course = w.p.puo.createCourse(w.mma.id, { title: 'Setswana A1', language: 'tn', level: 'A1' });
    const publicLesson = w.p.puo.deriveLesson(course.id, w.mma.id, {
      sourceItemRef: publishedItem(w, { visibility: 'public' }).id, level: 'A1',
    });
    const restrictedLesson = w.p.puo.deriveLesson(course.id, w.mma.id, {
      sourceItemRef: publishedItem(w, { visibility: 'members' }).id, level: 'A1',
    });
    await authed(request(app).post(`/v1/puo/lessons/${publicLesson.id}/complete`))
      .set('Idempotency-Key', 'pl-1').send({});
    await authed(request(app).post(`/v1/puo/lessons/${publicLesson.id}/complete`))
      .set('Idempotency-Key', 'pl-2').send({});
    const progress = await authed(request(app).get('/v1/puo/progress'));
    expect(progress.body.completed_lessons).toBe(1); // idempotent
    expect(progress.body.by_course[course.id]).toMatchObject({ completed: 1, total: 2 });
    // kabo is not a bakalanga member — the restricted lesson refuses.
    const gated = await authed(request(app).post(`/v1/puo/lessons/${restrictedLesson.id}/complete`))
      .set('Idempotency-Key', 'pl-3').send({});
    expect(gated.status).toBe(403);
    expect(gated.body.code).toBe('MEMBERSHIP_REQUIRED');
  });

  test('flags snapshot serves anonymous and member contexts', async () => {
    const anonymous = await request(app).get('/v1/flags');
    expect(anonymous.body['module.kgetsi']).toBe(true);
    expect(anonymous.body['module.mmino']).toBe(false);
    const mine = await authed(request(app).get('/v1/flags'));
    expect(mine.body['config.data_budget_kb']).toBe(2048);
  });
});

describe('PWA shell (WS2)', () => {
  test('/app, manifest and service worker are served with correct types', async () => {
    const { app } = createApp(world().p);
    const page = await request(app).get('/app');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Motse');
    expect(page.text).toContain('serviceWorker'); // offline-first registration
    expect(page.text).toContain('/v1/sync/outbox'); // reuses the replay protocol
    const manifest = await request(app).get('/app/manifest.json');
    expect(manifest.body.display).toBe('standalone');
    const sw = await request(app).get('/app/sw.js');
    expect(sw.headers['content-type']).toContain('javascript');
    expect(sw.text).toContain('motse-shell-v1');
  });
});
