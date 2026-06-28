'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { registerUser, createProviderProfile, auth } = require('./helpers');

const app = createApp();

describe('Favourite providers', () => {
  let customer;
  let provider;

  beforeEach(async () => {
    customer = await registerUser(app, 'customer', 'fc@example.com');
    provider = await registerUser(app, 'provider', 'fp@example.com');
    await createProviderProfile(app, provider.token, { businessName: 'Fave Co' });
  });

  it('saves, lists and removes a favourite', async () => {
    const add = await request(app)
      .post(`/api/favourites/${provider.user.id}`)
      .set(auth(customer.token));
    expect(add.status).toBe(201);

    const list = await request(app).get('/api/favourites').set(auth(customer.token));
    expect(list.body.data.length).toBe(1);
    expect(list.body.data[0].businessName).toBe('Fave Co');

    const remove = await request(app)
      .delete(`/api/favourites/${provider.user.id}`)
      .set(auth(customer.token));
    expect(remove.body.data.removed).toBe(true);

    const after = await request(app).get('/api/favourites').set(auth(customer.token));
    expect(after.body.data.length).toBe(0);
  });

  it('is idempotent when adding the same favourite twice', async () => {
    await request(app).post(`/api/favourites/${provider.user.id}`).set(auth(customer.token));
    await request(app).post(`/api/favourites/${provider.user.id}`).set(auth(customer.token));
    const list = await request(app).get('/api/favourites').set(auth(customer.token));
    expect(list.body.data.length).toBe(1);
  });

  it('rejects favouriting an unknown provider', async () => {
    const res = await request(app).post('/api/favourites/nope').set(auth(customer.token));
    expect(res.status).toBe(404);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/favourites');
    expect(res.status).toBe(401);
  });
});
