import { test, expect } from '@playwright/test';
import { register, createProviderProfile, authHeaders, uniqueEmail } from './helpers';

test.describe('Customer journey', () => {
  test('register → verify → browse → book → pay → chat → complete → review', async ({ request }) => {
    // A provider to book.
    const provider = await register(request, 'provider');
    await createProviderProfile(request, provider.token, { businessName: 'Kgosi Plumbing' });

    // Register + verify customer email.
    const email = uniqueEmail('customer');
    const customer = await register(request, 'customer', email);
    expect(customer.token).toBeTruthy();
    expect(customer.refreshToken).toBeTruthy();

    const verify = await request.post('/api/auth/verify-email', {
      data: { token: customer.devEmailVerificationToken },
    });
    expect(verify.ok()).toBeTruthy();

    // Login (fresh session).
    const login = await request.post('/api/auth/login', {
      data: { email, password: 'super-secret-pw' },
    });
    expect(login.ok()).toBeTruthy();
    const token = (await login.json()).data.token;
    const h = authHeaders(token);

    // Browse categories + search providers.
    const cats = await request.get('/api/categories');
    expect((await cats.json()).data.length).toBeGreaterThan(0);

    const search = await request.get('/api/providers?category=plumber');
    const results = (await search.json()).items;
    expect(results.length).toBeGreaterThan(0);

    // View profile + favourite.
    const profile = await request.get(`/api/providers/${provider.user.id}`);
    expect(profile.ok()).toBeTruthy();
    await request.post(`/api/favourites/${provider.user.id}`, { headers: h });
    const favs = await request.get('/api/favourites', { headers: h });
    expect((await favs.json()).data.length).toBe(1);

    // Saved address + availability slots.
    await request.post('/api/addresses', {
      headers: h,
      data: { label: 'Home', address: 'Phakalane', lat: -24.56, lng: 25.95, isDefault: true },
    });
    const slots = await request.get(`/api/availability/${provider.user.id}/slots?date=2026-06-29`);
    expect((await slots.json()).data.slots.length).toBeGreaterThan(0);

    // Create booking.
    const created = await request.post('/api/bookings', {
      headers: h,
      data: {
        providerId: provider.user.id,
        serviceType: 'plumbing',
        amount: 15000,
        scheduledFor: '2026-06-29T09:00:00.000Z',
        location: { lat: -24.65, lng: 25.91, address: 'Gaborone' },
      },
    });
    expect(created.ok()).toBeTruthy();
    const ref = (await created.json()).data.reference;

    // Provider accepts.
    await request.patch(`/api/bookings/${ref}/status`, {
      headers: authHeaders(provider.token),
      data: { status: 'accepted' },
    });

    // Pay (card) and settle via gateway webhook.
    const pay = await request.post(`/api/bookings/${ref}/pay`, {
      headers: h,
      data: { method: 'card' },
    });
    const paymentRef = (await pay.json()).data.payment.reference;
    await request.post('/api/payments/webhook/card', {
      data: { reference: paymentRef, status: 'PAID', id: 'sess_e2e' },
    });
    const payStatus = await request.get(`/api/bookings/${ref}/payment`, { headers: h });
    expect((await payStatus.json()).data.paymentStatus).toBe('succeeded');

    // Chat.
    await request.post(`/api/messages/${ref}`, { headers: h, data: { text: 'On my way?' } });
    const history = await request.get(`/api/messages/${ref}`, { headers: h });
    expect((await history.json()).data.messages.length).toBeGreaterThan(0);

    // Complete + review.
    await request.patch(`/api/bookings/${ref}/status`, {
      headers: authHeaders(provider.token),
      data: { status: 'in_progress' },
    });
    await request.patch(`/api/bookings/${ref}/status`, {
      headers: authHeaders(provider.token),
      data: { status: 'completed' },
    });
    const review = await request.post('/api/reviews', {
      headers: h,
      data: { providerId: provider.user.id, bookingReference: ref, rating: 5, comment: 'Great!' },
    });
    expect(review.ok()).toBeTruthy();

    // Rating reflected on the provider.
    const after = await request.get(`/api/providers/${provider.user.id}`);
    expect((await after.json()).data.rating).toBe(5);
  });
});
