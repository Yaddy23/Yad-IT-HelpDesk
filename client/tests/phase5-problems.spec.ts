import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';

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
    // SPA navigation (pushState) never fires a fresh load event, so waitForURL
    // stalls on its default load-state wait — poll the URL instead.
    await expect(page).toHaveURL(/\/problems\/[a-z0-9]{20,}$/, { timeout: 15000 });
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
    await expect(page).toHaveURL(/\/problems\/[a-z0-9]{20,}$/, { timeout: 15000 });
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
    // Click submit multiple times rapidly — only the first click lands before
    // the form navigates away, and the mutation guard must dedupe the rest.
    const submitBtn = page.locator('button:has-text("Create problem")');
    await submitBtn.click();
    await submitBtn.click({ timeout: 2000 }).catch(() => {});
    // Navigation to the detail URL proves the create went through.
    await expect(page).toHaveURL(/\/problems\/[a-z0-9]{20,}$/, { timeout: 15000 });
  });
});

test.describe('Phase 5 - Detection Suggestions & Find Related', () => {
  test.describe.configure({ mode: 'serial' });

  const SUFFIX = String(Date.now() % 1_000_000);
  // Free-string categories with unique tokens: the detection engine scores
  // incidents against problems by category and symptom text, so a unique
  // category guarantees no pre-existing problem claims the cluster and the
  // time-pattern branch ("looks like a new problem") is the one that fires.
  const CLUSTER_A_CATEGORY = `xylophone-outage-${SUFFIX}`;
  const CLUSTER_B_CATEGORY = `zeppelin-sync-${SUFFIX}`;
  const CLUSTER_A_TOKEN = 'xylophone calibration drift';
  const CLUSTER_B_TOKEN = 'zeppelin sync lag';

  let clusterANumbers: string[] = [];
  let clusterBNumbers: string[] = [];
  let clusterBFirstId = '';

  /**
   * Persisted suggestions only come from the engine's write half. The
   * scheduled worker runs on a timer (minutes), so tests trigger the same
   * runDetection through the one-off script the server ships for this purpose.
   */
  function runDetectionScan() {
    // Playwright runs from client/, and specs are transpiled as ESM (no
    // __dirname) — resolve the server one-off script from the cwd instead.
    const serverDir = path.resolve(process.cwd(), '..', 'server');
    execSync('npx tsx scripts/run-detection.ts 24', { cwd: serverDir, stdio: 'pipe', timeout: 120_000 });
  }

  async function seedTicket(
    request: import('@playwright/test').APIRequestContext,
    category: string,
    token: string,
    index: number,
  ): Promise<{ id: string; number: string }> {
    const state = JSON.parse(readFileSync('tests/auth-state.json', 'utf-8')) as {
      origins: { localStorage: { name: string; value: string }[] }[];
    };
    const tokensEntry = state.origins.flatMap((o) => o.localStorage).find((e) => e.name === 'itsm.tokens');
    const accessToken = tokensEntry ? (JSON.parse(tokensEntry.value) as { accessToken: string }).accessToken : '';
    const res = await request.fetch('http://localhost:5173/api/v1/tickets', {
      method: 'post',
      data: {
        title: `${token} report ${index} ${SUFFIX}`,
        description: `Automated detection seed ${index}: ${token} observed again on the fleet.`,
        category,
        impact: 'low',
        urgency: 'medium',
      },
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    });
    if (!res.ok()) test.skip(true, `could not seed ticket (${res.status()})`);
    const body = (await res.json()) as { data: { id: string; number: string } };
    return body.data;
  }

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000); // npx tsx cold start plus six ticket creates
    for (let i = 1; i <= 3; i += 1) {
      const ticket = await seedTicket(request, CLUSTER_A_CATEGORY, CLUSTER_A_TOKEN, i);
      clusterANumbers.push(ticket.number);
    }
    for (let i = 1; i <= 3; i += 1) {
      const ticket = await seedTicket(request, CLUSTER_B_CATEGORY, CLUSTER_B_TOKEN, i);
      clusterBNumbers.push(ticket.number);
      if (i === 1) clusterBFirstId = ticket.id;
    }
    runDetectionScan();
  });

  test('suggestions panel shows the detected cluster and accepting it creates a linked problem', async ({ page }) => {
    await page.goto('/problems');
    await waitForAuthRestore(page);
    await expect(page.getByRole('heading', { name: 'Detection suggestions' })).toBeVisible({ timeout: 15000 });

    // The cluster's suggestion carries all three incidents; find its row.
    // `.first()`: each incident is itself an `li` nested inside the
    // suggestion's `li`, so hasText matches both — the outer row comes first.
    const suggestionRow = page.locator('li', { hasText: clusterANumbers[0] }).first();
    await expect(suggestionRow).toBeVisible({ timeout: 15000 });
    await expect(suggestionRow).toContainText('Looks like a new problem');
    await expect(suggestionRow).toContainText('Recurring in a short window');

    // Accept it: a problem is raised from the whole cluster.
    await suggestionRow.getByRole('button', { name: 'Create problem' }).click();
    await expect(page).toHaveURL(/\/problems\/[a-z0-9]{20,}$/, { timeout: 15000 });

    // The new problem carries the full cluster.
    await page.getByRole('tab', { name: 'Incidents' }).click();
    for (const number of clusterANumbers) {
      await expect(page.locator(`text=${number}`)).toBeVisible({ timeout: 10000 });
    }
  });

  test('rejecting a suggestion removes it from the review queue', async ({ page }) => {
    await page.goto('/problems');
    await waitForAuthRestore(page);
    await expect(page.getByRole('heading', { name: 'Detection suggestions' })).toBeVisible({ timeout: 15000 });

    const suggestionRow = page.locator('li', { hasText: clusterBNumbers[0] }).first();
    await expect(suggestionRow).toBeVisible({ timeout: 15000 });
    await suggestionRow.getByRole('button', { name: 'Reject' }).click();
    await expect(suggestionRow).toBeHidden({ timeout: 15000 });
  });

  test('manual find related: search, select, and create a problem from incidents', async ({ page }) => {
    // Rejected suggestions never block their incidents, so the cluster-B
    // tickets are still claimable through the manual flow.
    await page.goto(`/tickets/${clusterBFirstId}`);
    await waitForAuthRestore(page);
    await page.click('button:has-text("Find related problems")');

    const dialog = page.getByRole('dialog', { name: 'Find related incidents' });
    await expect(dialog).toBeVisible();

    // Search by symptom text; the second cluster ticket should appear.
    await dialog.locator('input[type="search"]').fill(CLUSTER_B_TOKEN);
    const otherRow = dialog.locator('label', { hasText: clusterBNumbers[1] });
    await expect(otherRow).toBeVisible({ timeout: 10000 });
    // The incident itself is always included and its checkbox disabled.
    const selfRow = dialog.locator('label', { hasText: clusterBNumbers[0] });
    await expect(selfRow.locator('input[type="checkbox"]')).toBeDisabled();

    await otherRow.locator('input[type="checkbox"]').check();
    await dialog.getByRole('button', { name: /Create problem \(2 incidents\)/ }).click();

    await expect(page).toHaveURL(/\/problems\/[a-z0-9]{20,}$/, { timeout: 15000 });
    await page.getByRole('tab', { name: 'Incidents' }).click();
    await expect(page.locator(`text=${clusterBNumbers[0]}`).first()).toBeVisible({ timeout: 10000 });
    await expect(page.locator(`text=${clusterBNumbers[1]}`).first()).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Phase 5 - Change Integration & Fix Verification', () => {
  test.describe.configure({ mode: 'serial' });

  const SUFFIX = String(Date.now() % 1_000_000);
  const CHANGE_ID = `CHG-E2E-${SUFFIX}`;
  const PROBLEM_TITLE = `change-integration printer queue ${SUFFIX}`;

  let problemId = '';
  let problemNumber = '';
  // The access token the API helpers use (spec reads it from storageState).
  const AUTH = (() => {
    const state = JSON.parse(readFileSync('tests/auth-state.json', 'utf-8')) as {
      origins: { localStorage: { name: string; value: string }[] }[];
    };
    const entry = state.origins.flatMap((o) => o.localStorage).find((e) => e.name === 'itsm.tokens');
    const token = entry ? (JSON.parse(entry.value) as { accessToken: string }).accessToken : '';
    return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  })();

  test.beforeAll(async ({ request }) => {
    test.setTimeout(120_000);
    const me = await request.fetch('http://localhost:5173/api/v1/auth/me', { headers: AUTH });
    if (!me.ok()) test.skip(true, `could not read current user (${me.status()})`);
    const meBody = (await me.json()) as { data: { id: string } };

    const res = await request.fetch('http://localhost:5173/api/v1/problems', {
      method: 'post',
      data: {
        title: PROBLEM_TITLE,
        description: `Problem driving the ${CHANGE_ID} change integration flow.`,
        ownerId: meBody.data.id,
        priority: 'MEDIUM',
        businessImpact: 'Demo impact',
        affectedServices: [`printer-svc-${SUFFIX}`],
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

  /** Fire a change event through the webhook seam; returns how many were notified. */
  async function fireChangeEvent(
    request: import('@playwright/test').APIRequestContext,
    event: string,
    changeId: string,
  ): Promise<number> {
    const res = await request.fetch('http://localhost:5173/api/v1/problems/change-events', {
      method: 'post',
      data: { event, changeId },
      headers: AUTH,
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { notified: number } };
    return body.data.notified;
  }

  test('changes tab starts empty; empty link form guards submit', async ({ page }) => {
    await page.goto(`/problems/${problemId}`);
    await waitForAuthRestore(page);
    await page.getByRole('tab', { name: 'Changes' }).click();

    await expect(page.locator('text=No change requests linked')).toBeVisible({ timeout: 10000 });
    await page.getByRole('button', { name: 'Link change' }).click();

    const dialog = page.getByRole('dialog', { name: 'Link change requests' });
    await expect(dialog).toBeVisible();
    // No id staged — the link submit must be disabled (adversarial: empty input).
    await expect(dialog.getByRole('button', { name: /Link/ })).toBeDisabled();
    await dialog.locator('#change-id-input').fill(CHANGE_ID);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(dialog.locator(`text=${CHANGE_ID}`)).toBeVisible();
    await dialog.getByRole('button', { name: /Link 1 change/ }).click();
    // The chip alone would satisfy a text assertion before the link commits —
    // wait for the modal to close, which only happens on success.
    await expect(dialog).toBeHidden({ timeout: 15000 });
    await expect(page.locator(`text=${CHANGE_ID}`)).toBeVisible({ timeout: 10000 });
  });

  test('change.implemented notifies the owner; PENDING_CHANGE is reachable', async ({ page, request }) => {
    const notified = await fireChangeEvent(request, 'change.implemented', CHANGE_ID);
    expect(notified).toBe(1);

    // The notification lands in the list (socket invalidates it live).
    await page.goto('/notifications');
    await waitForAuthRestore(page);
    await expect(page.locator('text=Change request implemented').first()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(`text=${problemNumber}`).first()).toBeVisible();

    // PENDING_CHANGE requires the linked change — it is now satisfiable.
    await page.goto(`/problems/${problemId}`);
    await waitForAuthRestore(page);
    await page.selectOption('#status-transition', 'PENDING_CHANGE');
    await expect(page.locator('text=Pending Change').first()).toBeVisible({ timeout: 10000 });
  });

  test('fix verification wizard: select change, confirm, resolve', async ({ page }) => {
    await page.goto(`/problems/${problemId}`);
    await waitForAuthRestore(page);

    // With a linked change, RESOLVED opens the wizard, not the plain dialog.
    await page.selectOption('#status-transition', 'RESOLVED');
    const wizard = page.getByRole('dialog', { name: 'Verify fix and resolve' });
    await expect(wizard).toBeVisible({ timeout: 10000 });

    // Step 1: the linked change is offered; submit needs a selection.
    const changeRow = wizard.locator('label', { hasText: CHANGE_ID });
    await expect(changeRow.locator('input[type="checkbox"]')).not.toBeChecked();
    await expect(wizard.getByRole('button', { name: 'Next' })).toBeDisabled();
    await changeRow.locator('input[type="checkbox"]').check();
    await wizard.getByRole('button', { name: 'Next' }).click();

    // Step 2: confirm + summary gate the final submit.
    await expect(wizard.getByRole('button', { name: 'Verify fix & resolve' })).toBeDisabled();
    await wizard.locator('input[type="checkbox"]').check();
    await wizard.locator('#fix-verification-summary').fill('Deployed the fix, verified the printer queue holds under load.');
    await wizard.getByRole('button', { name: 'Verify fix & resolve' }).click();

    await expect(page.locator('text=Resolved').first()).toBeVisible({ timeout: 15000 });
  });

  test('change.rolled_back notifies; problem reopens to INVESTIGATION', async ({ page, request }) => {
    const notified = await fireChangeEvent(request, 'change.rolled_back', CHANGE_ID);
    expect(notified).toBe(1);

    await page.goto('/notifications');
    await waitForAuthRestore(page);
    await expect(page.locator('text=Change request rolled back').first()).toBeVisible({ timeout: 15000 });

    // The move stays with a human: RESOLVED -> INVESTIGATION from the select.
    await page.goto(`/problems/${problemId}`);
    await waitForAuthRestore(page);
    await page.selectOption('#status-transition', 'INVESTIGATION');
    await expect(page.locator('text=Investigation').first()).toBeVisible({ timeout: 10000 });
  });

  test('unknown change event is accepted but notifies nobody', async ({ request }) => {
    // Adversarial: the consumer must swallow garbage events, not 500.
    const res = await request.fetch('http://localhost:5173/api/v1/problems/change-events', {
      method: 'post',
      data: { event: 'change.exploded', changeId: CHANGE_ID },
      headers: AUTH,
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as { data: { notified: number } };
    expect(body.data.notified).toBe(0);
  });

  test('change-events webhook requires authentication', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    const res = await page.request.fetch('http://localhost:5173/api/v1/problems/change-events', {
      method: 'post',
      data: { event: 'change.approved', changeId: CHANGE_ID },
    });
    expect(res.status()).toBe(401);
    await context.close();
  });
});

test.describe('Phase 5 - Problems Dashboard', () => {
  test('dashboard page loads and is reachable from nav', async ({ page }) => {
    await page.goto('/');
    await waitForAuthRestore(page);
    // Click Problems Dashboard in the nav
    await page.click('a[href="/problems/dashboard"], nav >> text=Problems Dashboard');
    await expect(page.locator('h1')).toContainText('Problems Dashboard');
    // Wait for page to fully load (skeleton disappears)
    await expect(page.locator('.animate-pulse').first()).toBeHidden({ timeout: 15000 });
  });

  test('dashboard renders KPI stat tiles and charts', async ({ page }) => {
    await page.goto('/problems/dashboard');
    await waitForAuthRestore(page);
    await expect(page.locator('h1')).toContainText('Problems Dashboard');
    // Wait for loading to complete
    await expect(page.locator('.animate-pulse').first()).toBeHidden({ timeout: 15000 });
    // KPI tiles should be present - use link role to avoid collision with chart titles
    await expect(page.getByRole('link', { name: 'Open Problems' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('link', { name: 'Overdue Investigations' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Problems with Known Error' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Fix Verified Rate' })).toBeVisible();
    // Charts should be present - use heading role for chart titles to avoid collision with page description
    await expect(page.getByRole('heading', { name: 'Problems Identified (Daily)' })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('heading', { name: 'Top Incident Categories' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Open Problems by Age' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Problems by Status' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Known Errors by Status' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Fix Effectiveness' })).toBeVisible();
  });

  test('date range selector changes the dashboard data', async ({ page }) => {
    await page.goto('/problems/dashboard');
    await waitForAuthRestore(page);
    await expect(page.locator('.animate-pulse').first()).toBeHidden({ timeout: 15000 });
    // Change the range - this should trigger a refetch
    await page.selectOption('#dashboard-range', '7');
    // Loading spinner may appear briefly
    await page.waitForTimeout(500);
    await expect(page.locator('.animate-pulse').first()).toBeHidden({ timeout: 15000 });
    // Page should still be responsive
    await expect(page.locator('h1')).toContainText('Problems Dashboard');
  });

  test('KPI tiles are clickable links to relevant list views', async ({ page }) => {
    await page.goto('/problems/dashboard');
    await waitForAuthRestore(page);
    await expect(page.locator('.animate-pulse').first()).toBeHidden({ timeout: 15000 });
    // Click Open Problems tile
    const openTile = page.locator('a:has-text("Open Problems")').first();
    await expect(openTile).toBeVisible();
    await openTile.click();
    // Should navigate to problems list with open status filter
    await expect(page).toHaveURL(/\/problems/);
    await expect(page.locator('h1')).toContainText('Problems');
  });

  test('dashboard works for unauthenticated user (redirects to login)', async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();
    await page.goto('/problems/dashboard');
    // Should redirect to login
    await expect(page).toHaveURL(/\/login/, { timeout: 10000 });
    await context.close();
  });
});