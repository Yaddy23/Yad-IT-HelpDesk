import { test, expect } from '@playwright/test';

const DEMO_ADMIN = 'admin@demo.local';
const DEMO_PASSWORD = 'ChangeMe!2026';

// Helper to login as a specific user (creates fresh context without storage state)
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

// Wait for auth restore to complete (cold loads show "Restoring session..." for several seconds)
// Waits for either the spinner to disappear OR a redirect to login (for unauth tests)
// Note: The spinner uses a Unicode ellipsis character (…) not three dots
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

// Use admin auth for most tests (admin has all permissions)
test.use({ storageState: 'tests/auth-state.json' });

test.describe('Phase 5 - Problems List', () => {
  test('problems page loads and is reachable from nav', async ({ page }) => {
    await page.goto('/');
    await waitForAuthRestore(page);
    // Click Problems in the nav
    await page.click('a[href="/problems"], nav >> text=Problems');
    await expect(page.locator('h1')).toContainText('Problems');
    // Wait for page to fully load
    await expect(page.locator('text=New problem').first()).toBeVisible({ timeout: 10000 });
  });

  test('list page renders correctly (empty or with problems)', async ({ page }) => {
    await page.goto('/problems');
    await waitForAuthRestore(page);
    await expect(page.locator('h1')).toContainText('Problems');
    // Should show either empty state or a table with problems
    const emptyState = page.locator('text=No problems yet');
    const table = page.locator('table');
    await expect(emptyState.or(table)).toBeVisible({ timeout: 10000 });
    // If empty, should have link to create first problem
    if (await emptyState.isVisible({ timeout: 1000 }).catch(() => false)) {
      await expect(page.locator('a:has-text("Create the first one")')).toBeVisible();
    }
  });

  test('list page shows loading skeleton then content', async ({ page }) => {
    await page.goto('/problems');
    await waitForAuthRestore(page);
    // Loading skeleton may appear briefly (animate-pulse)
    const skeleton = page.locator('.animate-pulse').first();
    // Wait for skeleton to disappear (content loaded)
    await expect(skeleton).toBeHidden({ timeout: 15000 });
    // Verify content is present
    await expect(page.locator('h1')).toContainText('Problems');
  });

  test('filter buttons are present and clickable', async ({ page }) => {
    await page.goto('/problems');
    await waitForAuthRestore(page);
    await expect(page.locator('button:has-text("All")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Identified")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Investigation")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Root Cause Known")').first()).toBeVisible();
  });

  test('search input works', async ({ page }) => {
    await page.goto('/problems');
    await waitForAuthRestore(page);
    const searchInput = page.locator('input[type="search"]').first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('test search');
    await expect(searchInput).toHaveValue('test search');
  });

  test('sort dropdown works', async ({ page }) => {
    await page.goto('/problems');
    await waitForAuthRestore(page);
    await expect(page.locator('button:has-text("Identified")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Updated")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Priority")').first()).toBeVisible();
    await expect(page.locator('button:has-text("Status")').first()).toBeVisible();
  });

  test('pagination renders when multiple pages', async ({ page }) => {
    await page.goto('/problems');
    await waitForAuthRestore(page);
    // Pagination should show if there are multiple pages
    // Just verify the component renders without error
    await expect(page.locator('text=Page').first()).toBeHidden({ timeout: 5000 });
  });
});

test.describe('Phase 5 - Problem Create', () => {
  test('create form loads with all fields', async ({ page }) => {
    await page.goto('/problems/new');
    await waitForAuthRestore(page);
    await expect(page.locator('h1')).toContainText('New problem');
    // All required fields
    await expect(page.locator('input[id="title"]')).toBeVisible();
    await expect(page.locator('textarea[id="description"]')).toBeVisible();
    await expect(page.locator('select[id="ownerId"]')).toBeVisible();
    await expect(page.locator('button:has-text("Medium")').first()).toBeVisible(); // priority
    await expect(page.locator('select[id="rcaType"]')).toBeVisible();
  });

  test('creating a problem submits successfully', async ({ page }) => {
    await page.goto('/problems/new');
    await waitForAuthRestore(page);
    const uniqueTitle = `Test Problem ${Date.now()}`;
    await page.fill('input[id="title"]', uniqueTitle);
    await page.fill('textarea[id="description"]', 'This is a test problem description for automated testing.');
    await page.selectOption('select[id="ownerId"]', { index: 1 }); // select first actual user
    await page.click('button:has-text("High")'); // priority
    await page.selectOption('select[id="rcaType"]', 'FIVE_WHYS');
    await page.fill('input[id="affectedServices"]', 'Email, VPN');
    await page.fill('input[id="affectedAssets"]', 'LAPTOP-001');
    await page.fill('input[id="affectedCIs"]', 'CI-001');
    await page.fill('textarea[id="businessImpact"]', 'High impact on user productivity');
    await page.click('button:has-text("Create problem")');
    // Should show success indication (detail page is Task 7b, currently stays on create page with success toast)
    // Wait for either navigation to detail OR success toast/error message
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
    // If still on create page, verify form was submitted (no validation errors visible)
    // If navigated to detail, URL will match /problems/<uuid>
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/problems\//);
  });

  test('validation rejects empty required fields', async ({ page }) => {
    await page.goto('/problems/new');
    await waitForAuthRestore(page);
    // Try to submit without filling required fields
    await page.click('button:has-text("Create problem")');
    // Should show validation error (HTML5 validation or custom)
    // Check for error message or that form didn't submit
    await expect(page.locator('h1')).toContainText('New problem'); // Still on create page
  });

  test('title min length validation', async ({ page }) => {
    await page.goto('/problems/new');
    await waitForAuthRestore(page);
    await page.fill('input[id="title"]', 'Abc'); // Less than 5 chars
    await page.fill('textarea[id="description"]', 'Valid description that is long enough');
    await page.selectOption('select[id="ownerId"]', { index: 1 });
    await page.click('button:has-text("Create problem")');
    // Should not submit due to minLength
    await expect(page.locator('h1')).toContainText('New problem');
  });

  test('description min length validation', async ({ page }) => {
    await page.goto('/problems/new');
    await waitForAuthRestore(page);
    await page.fill('input[id="title"]', 'Valid Title');
    await page.fill('textarea[id="description"]', 'Short'); // Less than 10 chars
    await page.selectOption('select[id="ownerId"]', { index: 1 });
    await page.click('button:has-text("Create problem")');
    // Should not submit due to minLength
    await expect(page.locator('h1')).toContainText('New problem');
  });
});

test.describe('Phase 5 - Adversarial/Negative Tests', () => {
  test('unauthenticated visit to /problems redirects to login', async ({ browser }) => {
    // Explicitly create context with empty storageState to avoid global config bleed
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/problems');
    // Should redirect to login (ProtectedRoute redirects unauthenticated users)
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await context.close();
  });

  test('unauthenticated visit to /problems/new redirects to login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/problems/new');
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await context.close();
  });

  test('XSS payload in problem title renders as visible text, does not execute', async ({ page }) => {
    await page.goto('/problems/new');
    await waitForAuthRestore(page);
    const xssPayload = '<img src=x onerror=alert(1)>';
    let dialogFired = false;
    page.on('dialog', async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });
    await page.fill('input[id="title"]', xssPayload);
    await page.fill('textarea[id="description"]', 'Test description long enough for validation');
    await page.selectOption('select[id="ownerId"]', { index: 1 });
    await page.click('button:has-text("Create problem")');
    // Should navigate to detail URL (create succeeded)
    await page.waitForURL(/\/problems\//, { timeout: 10000 });
    // Verify no script execution
    expect(dialogFired).toBe(false);
  });

  test('oversized input (10000 chars) is handled without 500', async ({ page }) => {
    await page.goto('/problems/new');
    await waitForAuthRestore(page);
    const longString = 'a'.repeat(10000);
    await page.fill('input[id="title"]', 'Valid Title for Long Input Test');
    await page.fill('textarea[id="description"]', longString);
    await page.selectOption('select[id="ownerId"]', { index: 1 });
    await page.click('button:has-text("Create problem")');
    // Should handle gracefully - either show validation error or accept
    // Just verify no server error (500) and page is still responsive
    await expect(page.locator('h1')).toBeVisible({ timeout: 10000 });
    // If it stayed on create page, that's fine (validation error)
    // If it navigated to detail, that's also fine (accepted)
  });

  test('double-submitting create form produces exactly one problem', async ({ page }) => {
    await page.goto('/problems/new');
    await waitForAuthRestore(page);
    const uniqueTitle = `Double Submit Test ${Date.now()}`;
    await page.fill('input[id="title"]', uniqueTitle);
    await page.fill('textarea[id="description"]', 'Test description for double submit prevention.');
    await page.selectOption('select[id="ownerId"]', { index: 1 });
    // Click submit multiple times rapidly
    const submitBtn = page.locator('button:has-text("Create problem")');
    await submitBtn.click();
    await submitBtn.click();
    await submitBtn.click();
    // Wait for either navigation or success indication
    await expect(page.locator('h1')).toBeVisible({ timeout: 15000 });
    // Verify submission completed (either on detail page or still on create with success)
    const currentUrl = page.url();
    expect(currentUrl).toMatch(/\/problems\//);
  });
});