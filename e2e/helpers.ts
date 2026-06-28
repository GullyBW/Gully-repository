import { APIRequestContext, expect } from '@playwright/test';

/** Unique email per run to keep the in-memory store collision-free. */
export const uniqueEmail = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

export interface Session {
  token: string;
  refreshToken: string;
  user: { id: string; name: string; email: string; role: string };
  devEmailVerificationToken?: string;
}

export async function register(
  api: APIRequestContext,
  role: 'customer' | 'provider',
  email = uniqueEmail(role)
): Promise<Session & { email: string }> {
  const res = await api.post('/api/auth/register', {
    data: { name: `${role} user`, email, password: 'super-secret-pw', role },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { ...body.data, email };
}

export function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

export async function createProviderProfile(api: APIRequestContext, token: string, overrides = {}) {
  const res = await api.post('/api/providers', {
    headers: authHeaders(token),
    data: {
      businessName: 'Acme Services',
      category: 'plumber',
      bio: 'Reliable work',
      startingPrice: 20000,
      location: { lat: -24.6545, lng: 25.9086, address: 'Gaborone' },
      ...overrides,
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).data;
}

/** Seed an admin by registering then... there's no public admin role, so E2E
 * admin journeys use the JWT minted by the API for a provider/customer is not
 * enough. Instead we exercise admin endpoints via a dedicated helper that
 * relies on the test server allowing an admin to be created through register is
 * not possible; admin coverage uses the in-memory server's seeded behaviour. */
