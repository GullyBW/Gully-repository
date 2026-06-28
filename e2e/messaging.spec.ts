import { test, expect } from '@playwright/test';
import { register, createProviderProfile, authHeaders } from './helpers';

async function bookingBetween(request: any) {
  const provider = await register(request, 'provider');
  await createProviderProfile(request, provider.token);
  const customer = await register(request, 'customer');
  const created = await request.post('/api/bookings', {
    headers: authHeaders(customer.token),
    data: { providerId: provider.user.id, serviceType: 'plumbing', amount: 15000 },
  });
  const ref = (await created.json()).data.reference;
  return { provider, customer, ref };
}

test.describe('Messaging journey', () => {
  test('send → history → reactions → report', async ({ request }) => {
    const { provider, customer, ref } = await bookingBetween(request);

    const sent = await request.post(`/api/messages/${ref}`, {
      headers: authHeaders(customer.token),
      data: { text: 'Hi there' },
    });
    const messageId = (await sent.json()).data.id;

    const history = await request.get(`/api/messages/${ref}`, { headers: authHeaders(provider.token) });
    expect((await history.json()).data.messages.length).toBe(1);

    // Reaction toggles on/off.
    const reacted = await request.post(`/api/messages/${ref}/react`, {
      headers: authHeaders(provider.token),
      data: { messageId, emoji: '👍' },
    });
    expect((await reacted.json()).data.reactions.length).toBe(1);

    const reported = await request.post(`/api/messages/${ref}/report`, {
      headers: authHeaders(customer.token),
      data: { reason: 'spam' },
    });
    expect((await reported.json()).data.reported).toBe(true);
  });

  test('block prevents messaging both ways', async ({ request }) => {
    const { provider, customer, ref } = await bookingBetween(request);

    await request.post(`/api/blocks/${provider.user.id}`, { headers: authHeaders(customer.token) });
    const blocked = await request.post(`/api/messages/${ref}`, {
      headers: authHeaders(provider.token),
      data: { text: 'Hello?' },
    });
    expect(blocked.status()).toBe(403);

    await request.delete(`/api/blocks/${provider.user.id}`, { headers: authHeaders(customer.token) });
    const ok = await request.post(`/api/messages/${ref}`, {
      headers: authHeaders(provider.token),
      data: { text: 'Hi again' },
    });
    expect(ok.status()).toBe(201);
  });
});
