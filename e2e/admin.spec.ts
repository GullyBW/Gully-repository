import { test, expect } from '@playwright/test';
import { register, createProviderProfile, authHeaders } from './helpers';

async function seedAdmin(request: any): Promise<string> {
  const res = await request.post('/__test__/seed-admin');
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}

test.describe('Administrator journey', () => {
  test('dashboard → verify provider → bookings → payments → broadcast → audit', async ({ request }) => {
    const adminToken = await seedAdmin(request);
    const h = authHeaders(adminToken);

    // Seed a provider + booking to populate stats.
    const provider = await register(request, 'provider');
    await createProviderProfile(request, provider.token);
    const customer = await register(request, 'customer');
    await request.post('/api/bookings', {
      headers: authHeaders(customer.token),
      data: { providerId: provider.user.id, serviceType: 'plumbing', amount: 15000 },
    });

    // Dashboard.
    const dash = await request.get('/api/admin/dashboard', { headers: h });
    expect(dash.ok()).toBeTruthy();
    expect((await dash.json()).data.users.total).toBeGreaterThan(0);

    // Non-admin is forbidden.
    const denied = await request.get('/api/admin/dashboard', { headers: authHeaders(customer.token) });
    expect(denied.status()).toBe(403);

    // Verify provider (audited).
    const verify = await request.patch(`/api/admin/providers/${provider.user.id}/verify`, {
      headers: h,
      data: { verified: true },
    });
    expect((await verify.json()).data.verified).toBe(true);

    // Bookings + payments monitoring.
    const bookings = await request.get('/api/admin/bookings', { headers: h });
    expect(Array.isArray((await bookings.json()).data)).toBeTruthy();
    const payments = await request.get('/api/admin/payments', { headers: h });
    expect(payments.ok()).toBeTruthy();

    // Broadcast.
    const bc = await request.post('/api/admin/broadcast', {
      headers: h,
      data: { role: 'customer', title: 'Welcome', body: 'Hello Botswana' },
    });
    expect((await bc.json()).data.sent).toBeGreaterThan(0);

    // Audit log shows the verification.
    const audit = await request.get('/api/admin/audit-logs?action=provider_verified', { headers: h });
    expect((await audit.json()).data.length).toBeGreaterThan(0);
  });
});
