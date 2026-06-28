import { test, expect } from '@playwright/test';
import { uiRegister, seedProvider } from './ui-helpers';

test.describe('Customer UI journey', () => {
  test('browse category → provider → favourite', async ({ page, request }) => {
    await seedProvider(request, { businessName: 'Seeded Plumbing', category: 'plumber' });
    await uiRegister(page, 'customer');

    // Browse the Plumber category from the home grid.
    await page.getByText('Plumber', { exact: true }).click();
    await expect(page).toHaveURL(/providers/);
    await expect(page.getByText('Seeded Plumbing').first()).toBeVisible();

    // Open the provider profile.
    await page.getByText('Seeded Plumbing').first().click();
    await expect(page).toHaveURL(/providers\//);
    await expect(page.getByRole('button', { name: /Book now/ })).toBeVisible();

    // Favourite (heart icon is the 2nd end button after share), then verify.
    await page.locator('ion-buttons[slot="end"] ion-button').nth(1).click();
    await page.goto('/favourites');
    await expect(page.getByText('Seeded Plumbing').first()).toBeVisible();
  });

  test('logout returns to login', async ({ page }) => {
    await uiRegister(page, 'customer');
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page).toHaveURL(/login/);
  });
});
