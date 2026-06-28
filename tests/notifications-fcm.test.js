'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const PushService = require('../src/services/push.service');
const { registerUser, auth } = require('./helpers');

const app = createApp();

describe('FCM: device tokens, preferences, push', () => {
  let user;
  beforeEach(async () => {
    user = await registerUser(app, 'customer', 'fcm@example.com');
  });

  it('registers and lists a device token', async () => {
    const reg = await request(app)
      .post('/api/notifications/devices')
      .set(auth(user.token))
      .send({ token: 'device-token-abc123', platform: 'android' });
    expect(reg.status).toBe(201);
    expect(reg.body.data.platform).toBe('android');

    const list = await request(app).get('/api/notifications/devices').set(auth(user.token));
    expect(list.body.data.length).toBe(1);
  });

  it('reads and updates notification preferences', async () => {
    const get = await request(app).get('/api/notifications/preferences').set(auth(user.token));
    expect(get.body.data.bookings).toBe(true);

    const upd = await request(app)
      .put('/api/notifications/preferences')
      .set(auth(user.token))
      .send({ marketing: false });
    expect(upd.body.data.marketing).toBe(false);
    expect(upd.body.data.bookings).toBe(true);
  });

  it('dispatches push to registered devices (console transport)', async () => {
    await request(app)
      .post('/api/notifications/devices')
      .set(auth(user.token))
      .send({ token: 'device-token-xyz', platform: 'web' });

    const results = await PushService.dispatch(user.user.id, {
      title: 'Hi',
      body: 'Test',
      data: { x: 1 },
    });
    expect(results.length).toBe(1);
    expect(results[0].delivered).toBe(true);
  });
});
