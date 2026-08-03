import { expect, test } from '@playwright/test';

test('renders the identity session entry without interview business', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '身份与会话基础' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await expect(page.getByText(/不包含长者项目或访谈业务/)).toBeVisible();
});
