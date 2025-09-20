import { expect, test } from '../utils/base-test';

test.skip('Alerts Functionality', { tag: ['@alerts', '@full-server'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/alerts');
  });

  test('should load alerts page', async ({ page }) => {
    await test.step('Navigate to alerts page', async () => {
      await page.goto('/alerts');
    });

    await test.step('Verify alerts page loads with content', async () => {
      const alertsPage = page.locator('[data-testid="alerts-page"]');
      await expect(alertsPage).toBeVisible();

      const alertCards = page.locator('[data-testid^="alert-card-"]');
      const alertCount = await alertCards.count();
      await expect(alertCount).toBeGreaterThan(0);
    });

    await test.step('Verify alert links are accessible', async () => {
      const alertCards = page.locator('[data-testid^="alert-card-"]');
      const firstAlert = alertCards.first();
      const alertLink = firstAlert.locator('[data-testid^="alert-link-"]');
      await expect(alertLink).toBeVisible();
    });
  });

  test('should handle alerts creation from search', async ({ page }) => {
    await test.step('Navigate to search page', async () => {
      await page.goto('/search');
      await page.waitForLoadState('networkidle');
    });

    await test.step('Open alerts creation modal', async () => {
      const alertsButton = page.locator('[data-testid="alerts-button"]');
      await expect(alertsButton).toBeVisible();
      await alertsButton.scrollIntoViewIfNeeded();
      await alertsButton.click({ force: true });
      await page.waitForTimeout(1000);
    });

    await test.step('Verify alerts modal opens', async () => {
      await expect(page.locator('[data-testid="alerts-modal"]')).toBeVisible();
    });
  });
});
