import { expect, test } from '@playwright/test';

test('real Web and API use HttpOnly Cookie, Origin and CSRF for the login lifecycle', async ({
  context,
  page,
}) => {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('listener-a@example.test');
  await page.getByLabel('密码').fill('Fictional-only-Password-42!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();
  await expect(page.getByText('虚构倾听员 A')).toBeVisible();
  expect(await page.evaluate(() => document.cookie)).not.toContain('elder_interview_session');

  await page.reload();
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();

  await page.evaluate(async () => fetch('/api/v1/auth/csrf'));

  const cookiesBeforeLogout = await context.cookies(page.url());
  expect(cookiesBeforeLogout.map((cookie) => cookie.name)).toEqual(['elder_interview_session']);
  const logoutStatuses: number[] = [];
  let successfulLogoutClearsCookie = false;
  page.on('response', (response) => {
    if (!response.url().endsWith('/api/v1/auth/logout')) return;
    logoutStatuses.push(response.status());
    if (response.status() === 200) {
      successfulLogoutClearsCookie =
        response.headers()['set-cookie']?.includes('Max-Age=0') === true;
    }
  });
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
  await expect.poll(() => logoutStatuses).toEqual([403, 200]);
  expect(successfulLogoutClearsCookie).toBe(true);
  const cookiesAfterLogout = await context.cookies(page.url());
  expect(
    cookiesAfterLogout.filter((cookie) => cookie.name === 'elder_interview_session'),
  ).toHaveLength(0);
  const meStatus = await page.evaluate(
    async () => (await fetch('/api/v1/auth/me', { cache: 'no-store' })).status,
  );
  expect(meStatus).toBe(401);
  const directMe = await context.request.get('http://127.0.0.1:3101/api/v1/auth/me', {
    headers: { Origin: 'http://127.0.0.1:4173' },
  });
  expect(directMe.status()).toBe(401);
});

test('logout failure preserves the authenticated UI state', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('邮箱').fill('listener-a@example.test');
  await page.getByLabel('密码').fill('Fictional-only-Password-42!');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();
  await page.route('**/api/v1/auth/logout', async (route) => route.fulfill({ status: 403 }));
  await page.route('**/api/v1/auth/csrf', async (route) => route.fulfill({ status: 500 }));
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '已登录' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('退出失败');
});
