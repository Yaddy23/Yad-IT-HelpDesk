import { chromium, FullConfig } from '@playwright/test';

const DEMO_ADMIN = 'admin@demo.local';
const DEMO_PASSWORD = 'ChangeMe!2026';

async function globalSetup(config: FullConfig) {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Login as admin
  await page.goto('http://localhost:5173/login');
  await page.fill('input[type="email"]', DEMO_ADMIN);
  await page.fill('input[type="password"]', DEMO_PASSWORD);
  await Promise.all([
    page.waitForURL(/\/(\?|$)/, { timeout: 60000 }),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForLoadState('networkidle');

  // Save storage state
  await page.context().storageState({ path: 'tests/auth-state.json' });
  await browser.close();
}

export default globalSetup;