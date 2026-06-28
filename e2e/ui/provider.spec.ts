import { test, expect } from '@playwright/test';
import { uiLoginAsSeededProvider } from './ui-helpers';

test.describe('Provider UI journey', () => {
  test('login → open provider dashboard', async ({ page, request }) => {
    await uiLoginAsSeededProvider(page, request);

    // Providers get a dashboard shortcut on Home.
    await page.getByRole('button', { name: /provider dashboard/i }).click();
    await expect(page).toHaveURL(/provider\/dashboard/);

    // Dashboard has Profile / Availability segments (lazy-loaded page).
    await expect(page.locator('ion-segment-button', { hasText: 'Profile' })).toBeVisible();
    await expect(page.locator('ion-segment-button', { hasText: 'Availability' })).toBeVisible();
  });

  test('provider can reach earnings analytics', async ({ page, request }) => {
    await uiLoginAsSeededProvider(page, request);
    await page.goto('/analytics/provider');
    await expect(page.getByText('My earnings')).toBeVisible();
  });
});
