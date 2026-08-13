import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const PROJECT_ID = '11111111-1111-4111-8111-111111111111';
const RESTRICTED_ID = '11111111-1111-4111-8111-111111111112';
const SESSION_ID = '22222222-2222-4222-8222-222222222222';

for (const viewport of [
  { height: 900, label: 'desktop', width: 1440 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 568, label: 'compact', width: 320 },
] as const) {
  test(`authenticated home is accessible without overflow at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const json = apiResponse(url.pathname);
      await route.fulfill({ contentType: 'application/json', json, status: 200 });
    });
    await page.goto('/');

    await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();
    await expect(page.getByText('虚构长者甲')).toBeVisible();
    await expect(page.getByText('受限项目')).toBeVisible();
    await expect(page.getByText('当前不可访问')).toBeVisible();
    await expect(page.getByText('受限长者真名')).toHaveCount(0);
    await expect(page.locator('[aria-live="polite"]')).toHaveCount(1);
    await expect(page.getByRole('button', { name: '查看回顾' })).toHaveCount(1);

    const layout = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      document: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(layout.body).toBeLessThanOrEqual(layout.viewport);
    expect(layout.document).toBeLessThanOrEqual(layout.viewport);
    expect(
      await page
        .getByRole('button')
        .evaluateAll((buttons) =>
          buttons.every((button) => button.getBoundingClientRect().height >= 44),
        ),
    ).toBe(true);
    expect(
      await page
        .getByRole('button', { name: '新建访谈' })
        .evaluate((button) => getComputedStyle(button).transitionDuration),
    ).toBe('1e-05s');
    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({
      fullPage: true,
      path: `output/playwright/dev-008a1-home-${viewport.label}-${String(viewport.width)}x${String(viewport.height)}.png`,
    });

    await page.getByRole('button', { name: '新建访谈' }).focus();
    await expect(page.getByRole('button', { name: '新建访谈' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: '最低项目信息' })).toBeVisible();
    await expect(page.getByText(/先确认当前页面的麦克风，再录制口头授权/)).toBeVisible();
    await page.getByRole('button', { name: '返回工作区' }).click();
    await expect(page.getByRole('heading', { name: '今天好，虚构倾听员 A' })).toBeVisible();
  });
}

function apiResponse(pathname: string): unknown {
  if (pathname === '/api/v1/auth/me') {
    return {
      display_name: '虚构倾听员 A',
      id: 'actor',
      role: 'interviewer',
      status: 'active',
    };
  }
  if (pathname === '/api/v1/auth/csrf') return { csrf_token: 'opaque-test-token' };
  if (pathname === '/api/v1/projects') {
    return {
      items: [
        {
          approximate_age: null,
          birth_year: null,
          created_at: '2026-08-12T08:00:00.000Z',
          created_by: 'actor',
          current_city: null,
          display_name: '虚构长者甲',
          id: PROJECT_ID,
          native_place: null,
          projection: 'ordinary',
          status: 'active',
          updated_at: '2026-08-12T08:00:00.000Z',
        },
        {
          display_label: '受限项目',
          project_id: RESTRICTED_ID,
          projection: 'restricted',
          status: 'restricted',
          status_label: '当前不可访问',
        },
      ],
    };
  }
  if (pathname === `/api/v1/projects/${PROJECT_ID}/sessions`) {
    return {
      items: [
        {
          capture: { status: 'stopped' },
          capture_failure_code: null,
          created_at: '2026-08-12T08:00:00.000Z',
          duration_seconds: 1800,
          ended_at: '2026-08-12T08:30:00.000Z',
          finalization: {
            failure_code: null,
            manifest_checksum: 'a'.repeat(64),
            recording_status: 'stopped',
            transcript_status: 'draining',
            upload_status: 'complete',
          },
          home_state: 'transcript_processing',
          id: SESSION_ID,
          primary_action: 'view_review',
          project_id: PROJECT_ID,
          review_access: 'read_only',
          sequence_no: 1,
          started_at: '2026-08-12T08:00:00.000Z',
          status: 'processing',
        },
      ],
      next_cursor: null,
    };
  }
  if (pathname === `/api/v1/sessions/${SESSION_ID}`) {
    return {
      capture: null,
      capture_failure_code: null,
      created_at: '2026-08-12T08:00:00.000Z',
      created_by: 'actor',
      duration_seconds: 1800,
      ended_at: '2026-08-12T08:30:00.000Z',
      finalization: null,
      id: SESSION_ID,
      project_id: PROJECT_ID,
      sequence_no: 1,
      started_at: '2026-08-12T08:00:00.000Z',
      status: 'processing',
      updated_at: '2026-08-12T08:30:00.000Z',
    };
  }
  return {};
}
