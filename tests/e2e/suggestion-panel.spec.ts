import { expect, test } from '@playwright/test';

test('one-question director UI keeps history across refresh and remains usable on small screens', async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/engineering-harness.html?suggestion_harness=1');

  const panel = page.getByTestId('suggestion-panel');
  await expect(panel).toContainText('下一步');
  await expect(panel).toContainText('低压力破冰阶段');
  await page.getByRole('button', { name: '上一个问题' }).click();
  await expect(panel).toContainText('先前显示的问题');
  await expect(page.getByRole('button', { name: '回到当前问题' })).toBeVisible();

  await page.reload();
  await expect(panel).toContainText('先前显示的问题');
  await expect(page.getByRole('button', { name: '回到当前问题' })).toBeVisible();
  await page.getByRole('button', { name: '回到当前问题' }).click();
  await page.getByRole('button', { name: '下一个问题' }).click();
  await expect(panel).toContainText('另一道 eligible synthetic fixture');

  await page.setViewportSize({ height: 568, width: 320 });
  const measurements = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.suggestion-panel button')];
    const panelElement = document.querySelector<HTMLElement>('.suggestion-panel');
    const reason = document.querySelector<HTMLElement>('.suggestion-panel__reason');
    return {
      horizontalOverflow: document.documentElement.scrollWidth - globalThis.innerWidth,
      minimumButtonHeight: Math.min(
        ...buttons.map((button) => button.getBoundingClientRect().height),
      ),
      panelHeight: panelElement?.getBoundingClientRect().height ?? 0,
      reasonVisible: (reason?.getClientRects().length ?? 0) > 0,
    };
  });
  expect(measurements.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(measurements.minimumButtonHeight).toBeGreaterThanOrEqual(44);
  expect(measurements.panelHeight).toBeLessThanOrEqual(120);
  expect(measurements.reasonVisible).toBe(true);
});
