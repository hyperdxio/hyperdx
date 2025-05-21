// tests/auth/register.spec.ts
import { expect, test } from '@playwright/test';
import { register, generateTestUser, setupDemoSources } from '../utils/registerHelper';

test.describe('User Registration and Initial Setup', () => {
  test('should register a new user and set up demo sources', async ({ page }) => {
    // Register a new user
    const testUser = generateTestUser();
    await register(page, testUser);

    // Verify we're redirected to the search page
    await page.waitForURL('http://localhost:8080/search');

    // Set up demo sources
    await setupDemoSources(page);

    // Verify we can access the sources
    // Click the source selector in the search bar
    const sourceSelect = page.locator('[data-testid="search-source-select"]');
    await expect(sourceSelect).toBeVisible({ timeout: 5000 });
    await sourceSelect.click();

    // Verify demo sources are available
    const demoLogs = page.getByRole('option', { name: 'Demo Logs' });
    await expect(demoLogs).toBeVisible({ timeout: 5000 });

    const demoTraces = page.getByRole('option', { name: 'Demo Traces' });
    await expect(demoTraces).toBeVisible();

    const demoMetrics = page.getByRole('option', { name: 'Demo Metrics' });
    await expect(demoMetrics).toBeVisible();

    const demoSessions = page.getByRole('option', { name: 'Demo Sessions' });
    await expect(demoSessions).toBeVisible();

    // Select the Demo Logs source
    await demoLogs.click();

    // Wait for search results to load
    const searchResults = page.locator('[data-testid="search-table-container"]');
    await expect(searchResults).toBeVisible({ timeout: 15000 });

    // Verify we get some log results
    const logRows = page.locator('[data-testid="log-row"]');
    await expect(logRows.first()).toBeVisible({ timeout: 15000 });
  });
});