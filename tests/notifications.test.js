'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { registerUser, createProviderProfile, auth } = require('./helpers');

const app = createApp();

describe('Notifications', () => {
  let customer;
  let provider;

  beforeEach(async () => {
    customer = await registerUser(app, 'customer', 'nc@example.com');
    provider = await registerUser(app, 'provider', 'np@example.com');
    await createProviderProfile(app, provider.token);
  });

  it('notifies the provider when a new booking is created', async () => {
    await request(app)
      .post('/api/bookings')
      .set(auth(customer.token))
      .send({ providerId: provider.user.id, serviceType: 'plumbing', amount: 15000 });

    const res = await request(app).get('/api/notifications').set(auth(provider.token));
    expect(res.status).toBe(200);
    expect(res.body.data.some((n) => n.type === 'new_booking')).toBe(true);
  });

  it('notifies the customer when the booking is accepted', async () => {
    const created = await request(app)
      .post('/api/bookings')
      .set(auth(customer.token))
      .send({ providerId: provider.user.id, serviceType: 'plumbing', amount: 15000 });

    await request(app)
      .patch(`/api/bookings/${created.body.data.reference}/status`)
      .set(auth(provider.token))
      .send({ status: 'accepted' });

    const res = await request(app).get('/api/notifications').set(auth(customer.token));
    expect(res.body.data.some((n) => n.type === 'booking_accepted')).toBe(true);
  });

  it('tracks unread count and marks notifications read', async () => {
    await request(app)
      .post('/api/bookings')
      .set(auth(customer.token))
      .send({ providerId: provider.user.id, serviceType: 'plumbing', amount: 15000 });

    const before = await request(app)
      .get('/api/notifications/unread-count')
      .set(auth(provider.token));
    expect(before.body.data.count).toBeGreaterThan(0);

    await request(app).patch('/api/notifications/read-all').set(auth(provider.token));

    const after = await request(app)
      .get('/api/notifications/unread-count')
      .set(auth(provider.token));
    expect(after.body.data.count).toBe(0);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });
});
