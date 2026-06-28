import { test, expect } from '@playwright/test';
import { uiLogin, seedAdmin, seedProvider } from './ui-helpers';

test.describe('Administrator UI journey', () => {
  test('login → dashboard → navigate sections', async ({ page, request }) => {
    await seedProvider(request);
    const admin = await seedAdmin(request);

    await uiLogin(page, admin.email, admin.password);
    await expect(page).toHaveURL(/tabs\/home/, { timeout: 15_000 });

    // Admin portal.
    await page.goto('/admin');
    await expect(page.getByText('Users')).toBeVisible();
    await expect(page.getByText('Provider management')).toBeVisible();

    // Provider management list loads.
    await page.getByText('Provider management').click();
    await expect(page).toHaveURL(/admin\/providers/);

    // Audit log viewer loads.
    await page.goto('/admin/audit');
    await expect(page.getByText('Audit logs')).toBeVisible();
  });

  test('non-admin cannot reach the admin portal', async ({ page }) => {
    // A freshly-registered customer is redirected away by the admin guard.
    await page.goto('/register');
    await page.locator('ion-input[label="Full name"] input').fill('Cust One');
    await page.locator('ion-input[label="Email"] input').fill(`c-${Date.now()}@example.com`);
    await page.locator('ion-input[label="Password (min 8 chars)"] input').fill('super-secret-pw');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/tabs\/home/);

    await page.goto('/admin');
    await expect(page).not.toHaveURL(/admin$/);
  });
});
