import { expect, test } from '@playwright/test';

test('renders the authenticated deep-link entry shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await expect(page.getByText(/已分配的访谈准备/)).toBeVisible();
});
