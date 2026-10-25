import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

const DEMO_ADMIN = 'admin@demo.local';
const DEMO_PASSWORD = 'ChangeMe!2026';

// The seeded admin holds every permission, so this spec exercises the full
// lifecycle in one actor: create (known_errors:create), approve
// (known_errors:approve), publish (known_errors:publish).

async function loginAs(page: import('@playwright/test').Page, email: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', DEMO_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/(\?|$)/, { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle');
}

async function waitForAuthRestore(page: import('@playwright/test').Page) {
  try {
    await Promise.race([
      page.waitForSelector('text=Restoring session…', { state: 'hidden', timeout: 30000 }),
      page.waitForURL(/\/login/, { timeout: 30000 }),
    ]);
  } catch {
    // Ignore timeout - if we get here, either spinner is gone or we're at login
  }
}

test.use({ storageState: 'tests/auth-state.json' });

/** Bearer token for direct API calls (auth is localStorage-based). */
function accessToken(): string {
  const state = JSON.parse(readFileSync('tests/auth-state.json', 'utf-8')) as {
    origins: { localStorage: { name: string; value: string }[] }[];
  };
  const entry = state.origins.flatMap((o) => o.localStorage).find((e) => e.name === 'itsm.tokens');
  return entry ? (JSON.parse(entry.value) as { accessToken: string }).accessToken : '';
}

const TOKEN = accessToken();
const AUTH = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const SUFFIX = String(Date.now() % 1_000_000);
const KE_TITLE = `bracket-terminal-flicker ${SUFFIX}`;
const KE_SYMPTOM_TOKEN = `flicker-${SUFFIX}`;

let problemId = '';
let problemNumber = '';
let knownErrorId = '';
let knownErrorNumber = '';

test.describe('Phase 5 - Known Error Library', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    // Problems require an owner id; the admin seeding the data owns it.
    const me = await request.fetch('http://localhost:5173/api/v1/auth/me', { headers: AUTH });
    if (!me.ok()) test.skip(true, `could not read current user (${me.status()})`);
    const meBody = (await me.json()) as { data: { id: string } };

    // A problem is the only source a known error can be raised from.
    const res = await request.fetch('http://localhost:5173/api/v1/problems', {
      method: 'post',
      data: {
        title: `known-error host problem ${SUFFIX}`,
        description: `Problem hosting the ${KE_SYMPTOM_TOKEN} known error.`,
        ownerId: meBody.data.id,
        priority: 'MEDIUM',
        businessImpact: 'Demo impact',
        affectedServices: [`service-${SUFFIX}`],
        affectedAssets: [],
        affectedCIs: [],
      },
      headers: AUTH,
    });
    if (!res.ok()) test.skip(true, `could not seed problem (${res.status()})`);
    const body = (await res.json()) as { data: { id: string; number: string } };
    problemId = body.data.id;
    problemNumber = body.data.number;
  });

  test('known errors page loads and nav link reaches it', async ({ page }) => {
    await page.goto('/');
    await waitForAuthRestore(page);
    await page.click('a[href="/known-errors"], nav >> text=Known Errors');
    await expect(page.locator('h1')).toContainText('Known Errors');
    await expect(page.locator('text=New known error').first()).toBeVisible({ timeout: 10000 });
  });

  test('create form guards: submit disabled until a source problem is chosen', async ({ page }) => {
    await page.goto('/known-errors/new');
    await waitForAuthRestore(page);
    // No ?problemId= — the picker must be present and required.
    await expect(page.locator('select[id="ke-problem"]')).toBeVisible();
    // The guard: nothing can be submitted without a source problem.
    await expect(page.locator('button:has-text("Create known error")')).toBeDisabled();
    await expect(page.locator('text=Failed to create known error')).toBeHidden();
  });

  test('create from problem via Workarounds tab button, prefilled problem link', async ({ page }) => {
    await page.goto(`/problems/${problemId}`);
    await waitForAuthRestore(page);
    await page.getByRole('tab', { name: 'Workarounds' }).click();
    const newKeLink = page.locator('a:has-text("New known error")');
    await expect(newKeLink).toBeVisible({ timeout: 10000 });
    await newKeLink.click();
    await expect(page).toHaveURL(new RegExp(`/known-errors/new\\?problemId=${problemId}`));

    // The source problem is shown read-only on the form.
    await expect(page.locator(`text=${problemNumber}`).first()).toBeVisible();
    await page.fill('#ke-title', KE_TITLE);
    await page.fill('#ke-root-cause', `Terminal firmware ${KE_SYMPTOM_TOKEN} corrupts the frame buffer on cold boot.`);
    await page.fill('#ke-symptoms', `Screens ${KE_SYMPTOM_TOKEN} on affected terminals after login.`);
    await page.fill('#ke-workaround', 'Power-cycle the terminal; firmware patch ships next window.');
    await page.click('button:has-text("Create known error")');
    await expect(page).toHaveURL(/\/known-errors\/[a-z0-9]{20,}$/, { timeout: 15000 });

    const url = new URL(page.url());
    knownErrorId = url.pathname.split('/').pop() ?? '';
    // The list/search tests key off the KE number, which the UI shows only as
    // part of page chrome — read it from the API.
    const keRes = await page.request.fetch(`http://localhost:5173/api/v1/known-errors/${knownErrorId}`, { headers: AUTH });
    const keBody = (await keRes.json()) as { data: { number: string } };
    knownErrorNumber = keBody.data.number;
    await expect(page.locator(`text=${KE_TITLE}`)).toBeVisible();
    await expect(page.locator('text=Draft').first()).toBeVisible();
  });

  test('detail page tabs show content; approval transitions DRAFT → UNDER_REVIEW → PUBLISHED', async ({ page }) => {
    await page.goto(`/known-errors/${knownErrorId}`);
    await waitForAuthRestore(page);

    // Details tab shows the created content.
    await expect(page.locator('text=Terminal firmware').first()).toBeVisible();

    // Approval tab: transition select offers only legal next states.
    await page.getByRole('tab', { name: 'approval' }).click();
    await expect(page.locator('#ke-status-transition')).toBeVisible();
    const options = page.locator('#ke-status-transition option');
    await expect(options).toHaveText(['Select a status…', 'Under Review', 'Retired']);

    await page.selectOption('#ke-status-transition', 'UNDER_REVIEW');
    await page.fill('#ke-review-notes', 'Reviewed in E2E run');
    await page.click('button:has-text("Apply transition")');
    await expect(page.locator('text=Under Review').first()).toBeVisible({ timeout: 10000 });

    // Now PUBLISHED — the option list must re-derive from the new state.
    await page.selectOption('#ke-status-transition', 'PUBLISHED');
    await page.click('button:has-text("Apply transition")');
    await expect(page.locator('text=Published').first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator('text=Owner:').first()).toBeVisible();
  });

  test('publish to KB appears; Linked tab shows the article and problem', async ({ page }) => {
    await page.goto(`/known-errors/${knownErrorId}`);
    await waitForAuthRestore(page);

    const publishButton = page.locator('button:has-text("Publish to KB")');
    await expect(publishButton).toBeVisible({ timeout: 10000 });
    await publishButton.click();
    await expect(publishButton).toBeHidden({ timeout: 15000 });

    await page.getByRole('tab', { name: 'linked' }).click();
    await expect(page.locator(`text=${problemNumber}`)).toBeVisible();
    // The published article renders as a link into the knowledge base.
    await expect(page.locator('a[href^="/knowledge/"]').first()).toBeVisible({ timeout: 10000 });
  });

  test('published known error is found by the employee self-service search', async ({ page }) => {
    // Search endpoint only returns PUBLISHED rows — assert via API plus UI list.
    const res = await page.request.fetch('http://localhost:5173/api/v1/known-errors/search', {
      params: { q: KE_SYMPTOM_TOKEN },
      headers: AUTH,
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { id: string; number: string }[] };
    expect(body.data.some((ke) => ke.id === knownErrorId)).toBeTruthy();

    await page.goto('/known-errors');
    await waitForAuthRestore(page);
    await page.fill('input[type="search"]', KE_TITLE);
    await page.press('input[type="search"]', 'Enter');
    await expect(page.locator(`a:has-text("${knownErrorNumber}")`)).toBeVisible({ timeout: 10000 });
  });

  test('unauthenticated user is redirected to login', async ({ browser }) => {
    // Explicitly empty storage: a bare newContext() inherits the config-level
    // storageState (this suite runs signed-in as admin).
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/known-errors');
    await waitForAuthRestore(page);
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });
});
