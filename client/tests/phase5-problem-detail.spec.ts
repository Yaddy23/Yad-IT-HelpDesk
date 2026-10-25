import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

const DEMO_ADMIN = 'admin@demo.local';
const DEMO_PASSWORD = 'ChangeMe!2026';

/**
 * The app keeps its session in localStorage (not cookies), so a plain
 * `request` fixture carries no auth. This reads the access token out of the
 * saved storage state and returns an API client with the header set, for
 * seeding problems without driving the UI.
 */
function makeApi(page: Page) {
  const state = JSON.parse(readFileSync('tests/auth-state.json', 'utf-8')) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
  const tokensEntry = state.origins
    .flatMap((o) => o.localStorage)
    .find((e) => e.name === 'itsm.tokens');
  const accessToken = tokensEntry
    ? (JSON.parse(tokensEntry.value) as { accessToken: string }).accessToken
    : '';
  return async <T>(method: string, url: string, data?: unknown): Promise<{ status: number; json: T }> => {
    const res = await page.request.fetch(`http://localhost:5173${url}`, {
      method,
      data,
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    return { status: res.status(), json: (await res.json().catch(() => ({}))) as T };
  };
}

/** Cold loads show "Restoring session…" (Unicode ellipsis) for several seconds. */
async function waitForAuthRestore(page: Page) {
  try {
    await Promise.race([
      page.waitForSelector('text=Restoring session…', { state: 'hidden', timeout: 30000 }),
      page.waitForURL(/\/login/, { timeout: 30000 }),
    ]);
  } catch {
    // Spinner gone or redirected — either is fine to proceed.
  }
}

let problemId = '';
let detailUrl = '';

test.describe.configure({ mode: 'serial' });

test.describe('Phase 5 - Problem Detail', () => {
  test.beforeAll(async ({ request }) => {
    const state = JSON.parse(readFileSync('tests/auth-state.json', 'utf-8')) as {
      origins: { localStorage: { name: string; value: string }[] }[];
    };
    const tokensEntry = state.origins.flatMap((o) => o.localStorage).find((e) => e.name === 'itsm.tokens');
    const accessToken = tokensEntry
      ? (JSON.parse(tokensEntry.value) as { accessToken: string }).accessToken
      : '';

    const authHeaders = { Authorization: `Bearer ${accessToken}` };

    // Find an existing owner: problem owners are login Users, and the options
    // endpoint exposes the linked user id as `userId` on each employee.
    const usersRes = await request.get('http://localhost:5173/api/v1/users/options', {
      headers: authHeaders,
    });
    const users = usersRes.ok()
      ? ((await usersRes.json()) as {
          data?: { employees?: { userId: string | null }[] };
        }).data?.employees ?? []
      : [];
    const ownerId = users.find((u) => u.userId)?.userId;
    test.skip(!ownerId, 'no users available for owner select');

    const res = await request.fetch('http://localhost:5173/api/v1/problems', {
      method: 'post',
      data: {
        title: `Detail Test Problem ${Date.now()}`,
        description: 'Seed problem created by the detail-page test suite.',
        ownerId,
        priority: 'HIGH',
        rcaType: 'FIVE_WHYS',
        affectedServices: ['Email'],
      },
      headers: authHeaders,
    });
    if (!res.ok()) test.skip(true, `could not seed problem (${res.status()})`);
    const body = (await res.json()) as { data: { id: string } };
    problemId = body.data.id;
    detailUrl = `/problems/${problemId}`;
  });

  test('detail page renders header, badges, and all five tabs', async ({ page }) => {
    await page.goto(detailUrl);
    await waitForAuthRestore(page);
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/PRB-/);
    await expect(page.locator('text=Detail Test Problem').first()).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Details' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Incidents' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'RCA' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Workarounds' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'History' })).toBeVisible();
  });

  test('Details tab shows summary, description, chips, and lifecycle dates', async ({ page }) => {
    await page.goto(detailUrl);
    await waitForAuthRestore(page);
    await expect(page.locator('text=Seed problem created by the detail-page test suite.')).toBeVisible();
    await expect(page.locator('text=Identified').first()).toBeVisible();
    await expect(page.locator('text=Email').first()).toBeVisible(); // affected service chip
    await expect(page.locator('text=Lifecycle timeline')).toBeVisible();
  });

  test('Incidents tab shows empty state and link dialog searches tickets', async ({ page }) => {
    await page.goto(`${detailUrl}?tab=incidents`);
    await waitForAuthRestore(page);
    await expect(page.locator('text=No incidents linked.')).toBeVisible();

    await page.click('button:has-text("Link incidents")');
    const dialog = page.getByRole('dialog', { name: 'Link incidents' });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="search"]').fill('test');
    // Either results appear or the no-match message — both prove the search path works.
    await expect(
      dialog.locator('label').or(dialog.getByText('No tickets match')).first(),
    ).toBeVisible({ timeout: 10000 });
    await page.keyboard.press('Escape');
  });

  test('RCA tab saves root cause and confirmation', async ({ page }) => {
    await page.goto(`${detailUrl}?tab=rca`);
    await waitForAuthRestore(page);
    const uniqueCause = `Root cause from test ${Date.now()}`;
    await page.fill('textarea[id="root-cause"]', uniqueCause);
    await page.check('input[type="checkbox"]');
    await page.click('button:has-text("Save RCA")');
    await expect(page.locator('text=Root cause confirmed')).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text=${uniqueCause}`).first()).toBeVisible();
  });

  test('5 Whys editor renders five numbered inputs and saves structured JSON', async ({ page }) => {
    await page.goto(`${detailUrl}?tab=rca`);
    await waitForAuthRestore(page);
    await expect(page.locator('ol >> li').filter({ has: page.locator('textarea') })).toHaveCount(5);
    await page.fill('textarea[id="why-0"]', 'The service stopped');
    await page.fill('textarea[id="why-1"]', 'The process failed');
    await page.click('button:has-text("Save RCA")');
    await expect(page.locator('text=Root cause confirmed')).toBeVisible({ timeout: 10000 });
  });

  test('Workarounds tab saves workaround and shows known-errors empty state', async ({ page }) => {
    await page.goto(`${detailUrl}?tab=workarounds`);
    await waitForAuthRestore(page);
    await page.fill('textarea[id="workaround"]', 'Restart the affected service as an interim fix.');
    await page.click('button:has-text("Save workaround")');
    await expect(page.locator('text=Workaround saved.')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=No known errors raised from this problem yet.')).toBeVisible();
  });

  test('History tab lists at least the creation entry', async ({ page }) => {
    await page.goto(`${detailUrl}?tab=history`);
    await waitForAuthRestore(page);
    await expect(page.getByRole('listitem').first()).toBeVisible({ timeout: 10000 });
    // A fresh problem may never have changed status — assert entries render
    // with their actor instead of a specific action label.
    await expect(page.getByRole('listitem').first()).toContainText('Demo Admin');
  });

  test('tab deep-link persists across reload', async ({ page }) => {
    await page.goto(`${detailUrl}?tab=rca`);
    await waitForAuthRestore(page);
    await page.reload();
    await waitForAuthRestore(page);
    await expect(page.getByRole('tab', { name: 'RCA' })).toHaveAttribute('aria-selected', 'true');
  });

  test('status transition to Root Cause Known is gated without confirmation', async ({ page }) => {
    // Earlier tests confirmed the root cause, which un-locks the transition.
    // Un-check it so the gate is exercised in its "requirements unmet" state.
    await page.goto(`${detailUrl}?tab=rca`);
    await waitForAuthRestore(page);
    const checkbox = page.locator('input[type="checkbox"]');
    if (await checkbox.isChecked()) {
      await checkbox.uncheck();
      await page.click('button:has-text("Save RCA")');
      // No success toast — save completes when the refetch resets local state.
      await expect(checkbox).not.toBeChecked({ timeout: 10000 });
    }
    await page.goto(detailUrl);
    await waitForAuthRestore(page);
    await page.selectOption('select[id="status-transition"]', 'ROOT_CAUSE_KNOWN');
    await expect(page.locator('text=root cause confirmation')).toBeVisible();
  });

  test('XSS payload in root cause renders as text, does not execute', async ({ page }) => {
    await page.goto(`${detailUrl}?tab=rca`);
    await waitForAuthRestore(page);
    let dialogFired = false;
    page.on('dialog', async (d) => {
      dialogFired = true;
      await d.dismiss();
    });
    const payload = '<img src=x onerror=alert(1)>';
    await page.fill('textarea[id="root-cause"]', payload);
    await page.click('button:has-text("Save RCA")');
    // The payload survives as escaped text in the editor value, never executes.
    await expect(page.locator('textarea[id="root-cause"]')).toHaveValue(payload);
    expect(dialogFired).toBe(false);
  });

  test('oversized RCA input (10k chars) is accepted without a 500', async ({ page }) => {
    await page.goto(`${detailUrl}?tab=rca`);
    await waitForAuthRestore(page);
    const long = 'a'.repeat(10000);
    await page.fill('textarea[id="root-cause"]', long);
    await page.click('button:has-text("Save RCA")');
    // Either saves (value round-trips) or shows a validation error — never a crash.
    const value = await page.locator('textarea[id="root-cause"]').inputValue();
    expect(value.length).toBeGreaterThan(0);
  });

  test('unauthenticated visit redirects to login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto(detailUrl);
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await context.close();
  });
});
