import { test, expect } from '@playwright/test';
import { uiRegister } from './ui-helpers';

test.describe('App shell & auth UI', () => {
  test('login page renders and routes to register', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByText('Welcome back')).toBeVisible();

    await page.getByRole('link', { name: 'Create one' }).click();
    await expect(page).toHaveURL(/register/);
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
  });

  test('customer can register and reach the home tab', async ({ page }) => {
    await uiRegister(page, 'customer');
    await expect(page.getByText(/What service do you need/i)).toBeVisible();
    await expect(page.getByText('Categories')).toBeVisible();
  });

  test('login form validation: empty submit stays on login', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/login/);
  });
});
