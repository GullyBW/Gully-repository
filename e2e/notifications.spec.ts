import { test, expect } from '@playwright/test';
import { register, createProviderProfile, authHeaders } from './helpers';

test.describe('Notification journey', () => {
  test('booking lifecycle notifications + device registration + preferences', async ({ request }) => {
    const provider = await register(request, 'provider');
    await createProviderProfile(request, provider.token);
    const customer = await register(request, 'customer');

    // Device registration (FCM token) + preferences.
    const dev = await request.post('/api/notifications/devices', {
      headers: authHeaders(customer.token),
      data: { token: `tok-${Date.now()}`, platform: 'android' },
    });
    expect(dev.ok()).toBeTruthy();

    const prefs = await request.put('/api/notifications/preferences', {
      headers: authHeaders(customer.token),
      data: { marketing: false },
    });
    expect((await prefs.json()).data.marketing).toBe(false);

    // Booking → provider gets a "new_booking" notification.
    const created = await request.post('/api/bookings', {
      headers: authHeaders(customer.token),
      data: { providerId: provider.user.id, serviceType: 'plumbing', amount: 15000 },
    });
    const ref = (await created.json()).data.reference;

    const provNotes = await request.get('/api/notifications', { headers: authHeaders(provider.token) });
    expect((await provNotes.json()).data.some((n: any) => n.type === 'new_booking')).toBeTruthy();

    // Accept → customer gets "booking_accepted".
    await request.patch(`/api/bookings/${ref}/status`, {
      headers: authHeaders(provider.token),
      data: { status: 'accepted' },
    });
    const custNotes = await request.get('/api/notifications', { headers: authHeaders(customer.token) });
    expect((await custNotes.json()).data.some((n: any) => n.type === 'booking_accepted')).toBeTruthy();

    // Unread count + mark all read.
    const count = await request.get('/api/notifications/unread-count', { headers: authHeaders(provider.token) });
    expect((await count.json()).data.count).toBeGreaterThan(0);
    await request.patch('/api/notifications/read-all', { headers: authHeaders(provider.token) });
    const after = await request.get('/api/notifications/unread-count', { headers: authHeaders(provider.token) });
    expect((await after.json()).data.count).toBe(0);
  });
});
