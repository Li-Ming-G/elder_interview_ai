import { expect, test } from '@playwright/test';

test('renders the engineering baseline entry', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '工程基线已就绪' })).toBeVisible();
});
