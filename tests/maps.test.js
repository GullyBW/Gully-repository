'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { registerUser, auth } = require('./helpers');

const app = createApp();

describe('Maps: saved addresses & directions', () => {
  let customer;
  beforeEach(async () => {
    customer = await registerUser(app, 'customer', 'maps@example.com');
  });

  it('saves, lists, updates and deletes addresses (multiple per customer)', async () => {
    const a1 = await request(app)
      .post('/api/addresses')
      .set(auth(customer.token))
      .send({ label: 'Home', address: 'Phakalane', lat: -24.56, lng: 25.95, isDefault: true });
    expect(a1.status).toBe(201);

    await request(app)
      .post('/api/addresses')
      .set(auth(customer.token))
      .send({ label: 'Office', address: 'CBD', lat: -24.65, lng: 25.91 });

    const list = await request(app).get('/api/addresses').set(auth(customer.token));
    expect(list.body.data.length).toBe(2);

    const upd = await request(app)
      .put(`/api/addresses/${a1.body.data.id}`)
      .set(auth(customer.token))
      .send({ label: 'My Home' });
    expect(upd.body.data.label).toBe('My Home');

    const del = await request(app)
      .delete(`/api/addresses/${a1.body.data.id}`)
      .set(auth(customer.token));
    expect(del.body.data.removed).toBe(true);
  });

  it('cannot access another customer address', async () => {
    const a = await request(app)
      .post('/api/addresses')
      .set(auth(customer.token))
      .send({ label: 'Home', address: 'X', lat: -24.5, lng: 25.9 });
    const intruder = await registerUser(app, 'customer', 'maps2@example.com');
    const res = await request(app)
      .put(`/api/addresses/${a.body.data.id}`)
      .set(auth(intruder.token))
      .send({ label: 'hax' });
    expect(res.status).toBe(403);
  });

  it('returns directions with distance and duration (sandbox)', async () => {
    const res = await request(app)
      .get('/api/geo/directions')
      .query({ fromLat: -24.6545, fromLng: 25.9086, toLat: -21.17, toLng: 27.5078 })
      .set(auth(customer.token));
    expect(res.status).toBe(200);
    expect(res.body.data.distanceKm).toBeGreaterThan(300);
    expect(res.body.data.durationMinutes).toBeGreaterThan(0);
  });
});
