import { Page, APIRequestContext, expect } from '@playwright/test';

const API = `http://127.0.0.1:${process.env.E2E_API_PORT || '4000'}`;

export const uniqueEmail = (p: string) =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

/** Fill an Ionic <ion-input label="..."> (Playwright pierces the open shadow root). */
export async function fillIon(page: Page, label: string, value: string) {
  const input = page.locator(`ion-input[label="${label}"] input, ion-textarea[label="${label}"] textarea`).first();
  await input.fill(value);
}

export async function clickButton(page: Page, name: string | RegExp) {
  await page.getByRole('button', { name }).first().click();
}

/** Register a customer through the UI; ends on the home tab. */
export async function uiRegister(
  page: Page,
  role: 'customer' = 'customer',
  email = uniqueEmail(role)
): Promise<string> {
  await page.goto('/register');
  await fillIon(page, 'Full name', `${role} ${email}`);
  await fillIon(page, 'Email', email);
  await fillIon(page, 'Password (min 8 chars)', 'super-secret-pw');
  await clickButton(page, 'Create account');
  await expect(page).toHaveURL(/tabs\/home/, { timeout: 15_000 });
  return email;
}

/** Provider accounts are created via the API (avoids flaky select UI), then the
 * browser logs in — provider-specific UI is exercised post-login. */
export async function uiLoginAsSeededProvider(page: Page, request: APIRequestContext) {
  const p = await seedProvider(request);
  await uiLogin(page, p.email, 'super-secret-pw');
  await expect(page).toHaveURL(/tabs\/home/, { timeout: 15_000 });
  return p;
}

export async function uiLogin(page: Page, email: string, password: string) {
  await page.goto('/login');
  await fillIon(page, 'Email', email);
  await fillIon(page, 'Password', password);
  await clickButton(page, 'Sign in');
}

/** Seed a provider with a profile directly via the API (fast setup for UI tests). */
export async function seedProvider(request: APIRequestContext, overrides = {}) {
  const email = uniqueEmail('provider');
  const reg = await request.post(`${API}/api/auth/register`, {
    data: { name: 'Seed Provider', email, password: 'super-secret-pw', role: 'provider' },
  });
  const data = (await reg.json()).data;
  await request.post(`${API}/api/providers`, {
    headers: { Authorization: `Bearer ${data.token}` },
    data: {
      businessName: 'Seeded Plumbing',
      category: 'plumber',
      bio: 'Seeded for UI tests',
      startingPrice: 18000,
      location: { lat: -24.6545, lng: 25.9086, address: 'Gaborone' },
      ...overrides,
    },
  });
  return { ...data, email };
}

export async function seedAdmin(request: APIRequestContext) {
  const res = await request.post(`${API}/__test__/seed-admin`);
  return res.json() as Promise<{ email: string; password: string; token: string }>;
}
