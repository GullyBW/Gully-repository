import { test, expect } from '@playwright/test';
import { uiRegister } from './ui-helpers';

test.describe('UX: dark mode, offline, responsive', () => {
  test('dark mode toggle applies the Ionic dark palette', async ({ page }) => {
    await uiRegister(page, 'customer');
    await page.goto('/settings');

    await page.getByText('Dark mode').click();
    const isDark = await page.evaluate(() =>
      document.documentElement.classList.contains('ion-palette-dark')
    );
    expect(isDark).toBeTruthy();
  });

  test('offline banner appears when the network drops', async ({ page, context }) => {
    await uiRegister(page, 'customer');

    await context.setOffline(true);
    await expect(page.getByText(/You are offline/i)).toBeVisible();

    await context.setOffline(false);
    await expect(page.getByText(/You are offline/i)).toBeHidden();
  });

  test('lazy-loaded route renders (recently viewed)', async ({ page }) => {
    await uiRegister(page, 'customer');
    await page.goto('/recently-viewed');
    await expect(page.getByText('Recently viewed')).toBeVisible();
  });
});
