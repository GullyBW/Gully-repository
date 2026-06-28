import { test, expect } from '@playwright/test';
import { register, createProviderProfile, authHeaders } from './helpers';

test.describe('Provider journey', () => {
  test('profile → availability → accept booking → complete → analytics', async ({ request }) => {
    const provider = await register(request, 'provider');
    const h = authHeaders(provider.token);

    await createProviderProfile(request, provider.token, { businessName: 'Sparky Electrical', category: 'electrician' });

    // Configure availability.
    const avail = await request.put('/api/availability', {
      headers: h,
      data: { startTime: '08:00', endTime: '12:00', slotMinutes: 60, workingDays: [1, 2, 3, 4, 5] },
    });
    expect(avail.ok()).toBeTruthy();

    // A customer books them.
    const customer = await register(request, 'customer');
    const created = await request.post('/api/bookings', {
      headers: authHeaders(customer.token),
      data: { providerId: provider.user.id, serviceType: 'electrician', amount: 25000 },
    });
    const ref = (await created.json()).data.reference;

    // Provider sees the booking + a notification.
    const myBookings = await request.get('/api/bookings', { headers: h });
    expect((await myBookings.json()).data.some((b: any) => b.reference === ref)).toBeTruthy();
    const notes = await request.get('/api/notifications', { headers: h });
    expect((await notes.json()).data.some((n: any) => n.type === 'new_booking')).toBeTruthy();

    // Accept → progress → complete.
    for (const status of ['accepted', 'in_progress', 'completed']) {
      const r = await request.patch(`/api/bookings/${ref}/status`, { headers: h, data: { status } });
      expect(r.ok()).toBeTruthy();
    }

    // Earnings / analytics + CSV export.
    const analytics = await request.get('/api/analytics/provider', { headers: h });
    expect((await analytics.json()).data).toHaveProperty('monthly');

    const csv = await request.get('/api/analytics/export?report=provider-monthly&format=csv', { headers: h });
    expect(csv.ok()).toBeTruthy();
    expect((await csv.text())).toContain('month');
  });
});
