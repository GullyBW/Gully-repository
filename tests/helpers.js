'use strict';

const request = require('supertest');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const config = require('../src/config');
const { getUserRepository } = require('../src/repositories');

/** Auth header helper. */
const auth = (token) => ({ Authorization: `Bearer ${token}` });

/**
 * Seed an admin user directly (the public register route only allows
 * customer/provider) and return a signed token for admin-only routes.
 */
async function makeAdmin() {
  const id = uuidv4();
  const user = {
    id,
    name: 'Admin',
    email: `admin-${id}@example.com`,
    role: 'admin',
    passwordHash: 'x',
    createdAt: new Date(),
  };
  await getUserRepository().create(user);
  const token = jwt.sign({ sub: id, role: 'admin', email: user.email }, config.auth.jwtSecret, {
    expiresIn: '1h',
  });
  return { token, user };
}

/** Register a user of a role and return { token, user }. */
async function registerUser(app, role, email, extra = {}) {
  const res = await request(app)
    .post('/api/auth/register')
    .send({ name: `${role} ${email}`, email, password: 'super-secret-pw', role, ...extra });
  return res.body.data;
}

/** Create/update a provider profile for an authenticated provider. */
async function createProviderProfile(app, token, overrides = {}) {
  const res = await request(app)
    .post('/api/providers')
    .set(auth(token))
    .send({
      businessName: 'Acme Services',
      category: 'plumber',
      bio: 'Reliable work',
      startingPrice: 20000,
      location: { lat: -24.6545, lng: 25.9086, address: 'Gaborone' },
      ...overrides,
    });
  return res.body.data;
}

/** Drive a booking from request to completed. Returns the booking reference. */
async function completeBooking(app, customer, provider, payload = {}) {
  const created = await request(app)
    .post('/api/bookings')
    .set(auth(customer.token))
    .send({
      providerId: provider.user.id,
      serviceType: 'plumbing',
      amount: 15000,
      location: { lat: -24.65, lng: 25.91, address: 'Gaborone' },
      ...payload,
    });
  const ref = created.body.data.reference;
  const steps = ['accepted', 'in_progress', 'completed'];
  for (const status of steps) {
    await request(app)
      .patch(`/api/bookings/${ref}/status`)
      .set(auth(provider.token))
      .send({ status });
  }
  return ref;
}

module.exports = { auth, registerUser, makeAdmin, createProviderProfile, completeBooking };
