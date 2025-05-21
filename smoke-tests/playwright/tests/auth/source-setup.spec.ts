// tests/auth/source-setup.spec.ts
import { expect, test } from '@playwright/test';
import { register, generateTestUser, setupCustomSource } from '../utils/registerHelper';

test.describe('Manual Source Setup', () => {
  test('should set up custom Clickhouse connection and log source', async ({ page }) => {
    // Register a new user
    const testUser = generateTestUser();
    await register(page, testUser);

    // Verify we're redirected to the search page
    await page.waitForURL('http://localhost:8080/search');

    // Set up a custom source
    const connectionName = 'Test Connection';
    const sourceName = 'Test Logs';
    await setupCustomSource(page, connectionName, sourceName);

    // Verify the source appears in the source selector
    const sourceSelect = page.locator('[data-testid="search-source-select"]');
    await expect(sourceSelect).toBeVisible({ timeout: 5000 });
    await sourceSelect.click();

    // Verify our test source is available
    const testSource = page.getByRole('option', { name: sourceName });
    await expect(testSource).toBeVisible({ timeout: 5000 });
  });
});