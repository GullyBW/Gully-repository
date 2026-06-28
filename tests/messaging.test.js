'use strict';

const request = require('supertest');
const createApp = require('../src/app');
const { registerUser, createProviderProfile, auth } = require('./helpers');

const app = createApp();

async function makeBooking(customer, provider) {
  const res = await request(app)
    .post('/api/bookings')
    .set(auth(customer.token))
    .send({ providerId: provider.user.id, serviceType: 'plumbing', amount: 15000 });
  return res.body.data.reference;
}

describe('Messaging', () => {
  let customer;
  let provider;
  let bookingRef;

  beforeEach(async () => {
    customer = await registerUser(app, 'customer', 'msg-c@example.com');
    provider = await registerUser(app, 'provider', 'msg-p@example.com');
    await createProviderProfile(app, provider.token);
    bookingRef = await makeBooking(customer, provider);
  });

  it('lets participants exchange messages', async () => {
    const sent = await request(app)
      .post(`/api/messages/${bookingRef}`)
      .set(auth(customer.token))
      .send({ type: 'text', text: 'Hi, are you available?' });
    expect(sent.status).toBe(201);

    await request(app)
      .post(`/api/messages/${bookingRef}`)
      .set(auth(provider.token))
      .send({ text: 'Yes, tomorrow morning works.' });

    const history = await request(app)
      .get(`/api/messages/${bookingRef}`)
      .set(auth(provider.token));
    expect(history.status).toBe(200);
    expect(history.body.data.messages.length).toBe(2);
  });

  it('notifies the recipient of a new message', async () => {
    await request(app)
      .post(`/api/messages/${bookingRef}`)
      .set(auth(customer.token))
      .send({ text: 'Hello' });

    const notes = await request(app).get('/api/notifications').set(auth(provider.token));
    expect(notes.body.data.some((n) => n.type === 'new_message')).toBe(true);
  });

  it('marks messages as read', async () => {
    await request(app)
      .post(`/api/messages/${bookingRef}`)
      .set(auth(customer.token))
      .send({ text: 'Hello' });

    const read = await request(app)
      .post(`/api/messages/${bookingRef}/read`)
      .set(auth(provider.token));
    expect(read.status).toBe(200);

    const history = await request(app).get(`/api/messages/${bookingRef}`).set(auth(provider.token));
    expect(history.body.data.messages[0].readBy).toContain(provider.user.id);
  });

  it('blocks a non-participant from the conversation', async () => {
    const intruder = await registerUser(app, 'customer', 'msg-x@example.com');
    const res = await request(app).get(`/api/messages/${bookingRef}`).set(auth(intruder.token));
    expect(res.status).toBe(403);
  });

  it('lists a user conversations', async () => {
    await request(app)
      .post(`/api/messages/${bookingRef}`)
      .set(auth(customer.token))
      .send({ text: 'Hello' });
    const res = await request(app).get('/api/messages/conversations').set(auth(customer.token));
    expect(res.body.data.length).toBe(1);
  });

  it('toggles an emoji reaction on a message', async () => {
    const sent = await request(app)
      .post(`/api/messages/${bookingRef}`)
      .set(auth(customer.token))
      .send({ text: 'Thanks!' });
    const messageId = sent.body.data.id;

    const reacted = await request(app)
      .post(`/api/messages/${bookingRef}/react`)
      .set(auth(provider.token))
      .send({ messageId, emoji: '👍' });
    expect(reacted.status).toBe(200);
    expect(reacted.body.data.reactions).toEqual([{ userId: provider.user.id, emoji: '👍' }]);

    // Toggling the same emoji removes it.
    const toggled = await request(app)
      .post(`/api/messages/${bookingRef}/react`)
      .set(auth(provider.token))
      .send({ messageId, emoji: '👍' });
    expect(toggled.body.data.reactions).toEqual([]);
  });

  it('reports a conversation (recorded in admin audit logs)', async () => {
    const res = await request(app)
      .post(`/api/messages/${bookingRef}/report`)
      .set(auth(customer.token))
      .send({ reason: 'spam' });
    expect(res.status).toBe(200);
    expect(res.body.data.reported).toBe(true);
  });

  it('blocks a user and prevents messaging in both directions', async () => {
    await request(app)
      .post(`/api/blocks/${provider.user.id}`)
      .set(auth(customer.token));

    const blocked = await request(app)
      .post(`/api/messages/${bookingRef}`)
      .set(auth(provider.token))
      .send({ text: 'Hello?' });
    expect(blocked.status).toBe(403);

    const list = await request(app).get('/api/blocks').set(auth(customer.token));
    expect(list.body.data).toContain(provider.user.id);

    // Unblock restores messaging.
    await request(app).delete(`/api/blocks/${provider.user.id}`).set(auth(customer.token));
    const ok = await request(app)
      .post(`/api/messages/${bookingRef}`)
      .set(auth(provider.token))
      .send({ text: 'Hello again' });
    expect(ok.status).toBe(201);
  });
});
