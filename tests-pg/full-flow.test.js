'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const createApp = require('../src/app');
const config = require('../src/config');
const { getUserRepository } = require('../src/repositories');

const app = createApp();
const auth = (t) => ({ Authorization: `Bearer ${t}` });
const email = (p) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

async function register(role, e = email(role)) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: `${role} ${e}`, email: e, password: 'super-secret-pw', role });
  return { ...res.body.data, email: e };
}

async function makeAdmin() {
  const id = uuidv4();
  await getUserRepository().create({
    id, name: 'Admin', email: `admin-${id}@example.com`, role: 'admin',
    passwordHash: 'x', emailVerified: true, blockedUserIds: [], createdAt: new Date(),
  });
  return { id, token: jwt.sign({ sub: id, role: 'admin', email: `admin-${id}@x.com` }, config.auth.jwtSecret) };
}

describe('Backend on PostgreSQL — end to end', () => {
  test('uses the postgres driver', () => {
    expect(config.db.driver).toBe('postgres');
  });

  test('auth: register, verify email, refresh rotation, sessions', async () => {
    const reg = await register('customer');
    expect(reg.token).toBeTruthy();
    expect(reg.refreshToken).toBeTruthy();

    const verify = await request(app)
      .post('/api/auth/verify-email')
      .send({ token: reg.devEmailVerificationToken });
    expect(verify.status).toBe(200);

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: reg.refreshToken });
    expect(refreshed.status).toBe(200);
    const reuse = await request(app).post('/api/auth/refresh').send({ refreshToken: reg.refreshToken });
    expect(reuse.status).toBe(401); // rotated/revoked

    const sessions = await request(app).get('/api/auth/sessions').set(auth(reg.token));
    expect(sessions.body.data.length).toBeGreaterThan(0);
  });

  test('provider profile + discovery search filters/sort/distance', async () => {
    const near = await register('provider');
    await request(app).post('/api/providers').set(auth(near.token)).send({
      businessName: 'Near Plumber', category: 'plumber', startingPrice: 10000,
      location: { lat: -24.6545, lng: 25.9086, address: 'Gaborone CBD' },
    });
    const far = await register('provider');
    await request(app).post('/api/providers').set(auth(far.token)).send({
      businessName: 'Far Plumber', category: 'plumber', startingPrice: 30000,
      location: { lat: -21.17, lng: 27.5078, address: 'Francistown' },
    });
    const elec = await register('provider');
    await request(app).post('/api/providers').set(auth(elec.token)).send({
      businessName: 'Sparky', category: 'electrician', startingPrice: 15000,
    });

    const byCat = await request(app).get('/api/providers').query({ category: 'electrician' });
    expect(byCat.body.total).toBe(1);
    expect(byCat.body.items[0].businessName).toBe('Sparky');

    const nearest = await request(app)
      .get('/api/providers')
      .query({ category: 'plumber', lat: -24.6545, lng: 25.9086, sort: 'nearest' });
    expect(nearest.body.items[0].businessName).toBe('Near Plumber');

    const text = await request(app).get('/api/providers').query({ q: 'sparky' });
    expect(text.body.total).toBe(1);
  });

  test('booking → pay (card webhook) → settle, messaging + reactions, review', async () => {
    const customer = await register('customer');
    const provider = await register('provider');
    await request(app).post('/api/providers').set(auth(provider.token)).send({
      businessName: 'Kgosi Plumbing', category: 'plumber', startingPrice: 15000,
      location: { lat: -24.65, lng: 25.91, address: 'Gaborone' },
    });

    const created = await request(app).post('/api/bookings').set(auth(customer.token)).send({
      providerId: provider.user.id, serviceType: 'plumbing', amount: 15000,
      location: { lat: -24.65, lng: 25.91, address: 'Gaborone' },
    });
    const ref = created.body.data.reference;

    // provider notified
    const notes = await request(app).get('/api/notifications').set(auth(provider.token));
    expect(notes.body.data.some((n) => n.type === 'new_booking')).toBe(true);

    await request(app).patch(`/api/bookings/${ref}/status`).set(auth(provider.token)).send({ status: 'accepted' });

    const pay = await request(app).post(`/api/bookings/${ref}/pay`).set(auth(customer.token)).send({ method: 'card' });
    const paymentRef = pay.body.data.payment.reference;
    await request(app).post('/api/payments/webhook/card').send({ reference: paymentRef, status: 'PAID', id: 's1' });
    const payStatus = await request(app).get(`/api/bookings/${ref}/payment`).set(auth(customer.token));
    expect(payStatus.body.data.paymentStatus).toBe('succeeded');

    // messaging: send, react (jsonb), markRead
    const sent = await request(app).post(`/api/messages/${ref}`).set(auth(customer.token)).send({ text: 'On the way?' });
    const messageId = sent.body.data.id;
    const reacted = await request(app).post(`/api/messages/${ref}/react`).set(auth(provider.token)).send({ messageId, emoji: '👍' });
    expect(reacted.body.data.reactions).toEqual([{ userId: provider.user.id, emoji: '👍' }]);
    await request(app).post(`/api/messages/${ref}/read`).set(auth(provider.token));
    const history = await request(app).get(`/api/messages/${ref}`).set(auth(provider.token));
    expect(history.body.data.messages[0].readBy).toContain(provider.user.id);

    // complete + review → rating recompute
    await request(app).patch(`/api/bookings/${ref}/status`).set(auth(provider.token)).send({ status: 'in_progress' });
    await request(app).patch(`/api/bookings/${ref}/status`).set(auth(provider.token)).send({ status: 'completed' });
    await request(app).post('/api/reviews').set(auth(customer.token))
      .send({ providerId: provider.user.id, bookingReference: ref, rating: 5, comment: 'Great' });
    const profile = await request(app).get(`/api/providers/${provider.user.id}`);
    expect(profile.body.data.rating).toBe(5);
  });

  test('saved addresses default-clearing + favourites', async () => {
    const customer = await register('customer');
    const provider = await register('provider');
    await request(app).post('/api/providers').set(auth(provider.token)).send({ businessName: 'Fav Co', category: 'cleaner' });

    await request(app).post('/api/addresses').set(auth(customer.token)).send({ label: 'Home', lat: -24.5, lng: 25.9, isDefault: true });
    await request(app).post('/api/addresses').set(auth(customer.token)).send({ label: 'Office', lat: -24.6, lng: 25.9, isDefault: true });
    const list = await request(app).get('/api/addresses').set(auth(customer.token));
    expect(list.body.data.filter((a) => a.isDefault).length).toBe(1); // clearDefault worked

    await request(app).post(`/api/favourites/${provider.user.id}`).set(auth(customer.token));
    const favs = await request(app).get('/api/favourites').set(auth(customer.token));
    expect(favs.body.data.length).toBe(1);
  });

  test('admin dashboard aggregations (countByRole, sumByStatus, countByStatus)', async () => {
    const admin = await makeAdmin();
    const provider = await register('provider');
    await request(app).post('/api/providers').set(auth(provider.token)).send({ businessName: 'Stat Co', category: 'plumber' });
    const customer = await register('customer');
    await request(app).post('/api/bookings').set(auth(customer.token))
      .send({ providerId: provider.user.id, serviceType: 'plumbing', amount: 15000 });

    const dash = await request(app).get('/api/admin/dashboard').set(auth(admin.token));
    expect(dash.status).toBe(200);
    expect(dash.body.data.users.total).toBeGreaterThanOrEqual(2);
    expect(dash.body.data.bookings.total).toBeGreaterThanOrEqual(1);
    expect(dash.body.data).toHaveProperty('revenue');

    const notif = await request(app).get('/api/notifications/unread-count').set(auth(provider.token));
    expect(notif.body.data.count).toBeGreaterThan(0);
    await request(app).patch('/api/notifications/read-all').set(auth(provider.token));
    const after = await request(app).get('/api/notifications/unread-count').set(auth(provider.token));
    expect(after.body.data.count).toBe(0);
  });
});
