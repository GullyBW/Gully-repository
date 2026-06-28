'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const {
  registerUser,
  makeAdmin,
  createProviderProfile,
  completeBooking,
  auth,
} = require('./helpers');

const app = createApp();

describe('Reviews & ratings', () => {
  let customer;
  let provider;

  beforeEach(async () => {
    customer = await registerUser(app, 'customer', 'rc@example.com');
    provider = await registerUser(app, 'provider', 'rp@example.com');
    await createProviderProfile(app, provider.token);
  });

  it('rejects a review when the booking is not completed', async () => {
    const created = await request(app)
      .post('/api/bookings')
      .set(auth(customer.token))
      .send({ providerId: provider.user.id, serviceType: 'plumbing', amount: 15000 });

    const res = await request(app)
      .post('/api/reviews')
      .set(auth(customer.token))
      .send({ providerId: provider.user.id, bookingReference: created.body.data.reference, rating: 5 });
    expect(res.status).toBe(409);
  });

  it('allows a review after completion and updates the provider rating', async () => {
    const ref = await completeBooking(app, customer, provider);
    const res = await request(app)
      .post('/api/reviews')
      .set(auth(customer.token))
      .send({ providerId: provider.user.id, bookingReference: ref, rating: 4, title: 'Good', comment: 'Tidy work' });
    expect(res.status).toBe(201);

    const profile = await request(app).get(`/api/providers/${provider.user.id}`);
    expect(profile.body.data.rating).toBe(4);
    expect(profile.body.data.reviewCount).toBe(1);

    const list = await request(app).get(`/api/reviews/provider/${provider.user.id}`);
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0].customerName).toBeDefined();
  });

  it('prevents two reviews for the same booking', async () => {
    const ref = await completeBooking(app, customer, provider);
    const body = { providerId: provider.user.id, bookingReference: ref, rating: 5 };
    await request(app).post('/api/reviews').set(auth(customer.token)).send(body);
    const dup = await request(app).post('/api/reviews').set(auth(customer.token)).send(body);
    expect(dup.status).toBe(409);
  });

  it('recomputes the average when a review is edited', async () => {
    const ref = await completeBooking(app, customer, provider);
    const created = await request(app)
      .post('/api/reviews')
      .set(auth(customer.token))
      .send({ providerId: provider.user.id, bookingReference: ref, rating: 2 });

    await request(app)
      .patch(`/api/reviews/${created.body.data.id}`)
      .set(auth(customer.token))
      .send({ rating: 5 });

    const profile = await request(app).get(`/api/providers/${provider.user.id}`);
    expect(profile.body.data.rating).toBe(5);
  });

  it('supports reporting and admin moderation (removed reviews drop from rating)', async () => {
    const ref = await completeBooking(app, customer, provider);
    const created = await request(app)
      .post('/api/reviews')
      .set(auth(customer.token))
      .send({ providerId: provider.user.id, bookingReference: ref, rating: 5 });
    const reviewId = created.body.data.id;

    const reporter = await registerUser(app, 'customer', 'reporter@example.com');
    const reported = await request(app)
      .post(`/api/reviews/${reviewId}/report`)
      .set(auth(reporter.token))
      .send({ reason: 'spam' });
    expect(reported.body.data.status).toBe('reported');

    const admin = await makeAdmin();
    await request(app)
      .patch(`/api/reviews/${reviewId}/moderate`)
      .set(auth(admin.token))
      .send({ action: 'remove' });

    const profile = await request(app).get(`/api/providers/${provider.user.id}`);
    expect(profile.body.data.reviewCount).toBe(0);
    expect(profile.body.data.rating).toBe(0);
  });
});
