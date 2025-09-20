import { expect, test } from '../utils/base-test';

test.describe('Chart Explorer Functionality', { tag: ['@charts'] }, () => {
  test('should interact with chart configuration', async ({ page }) => {
    // Navigate to chart explorer
    await page.goto('/chart');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    await test.step('Verify chart configuration form is accessible', async () => {
      const chartForm = page.locator('[data-testid="chart-explorer-form"]');
      await expect(chartForm).toBeVisible();
    });

    await test.step('Can run basic query and display chart', async () => {
      const runQueryButton = page.locator(
        '[data-testid="chart-run-query-button"]',
      );
      await expect(runQueryButton).toBeVisible();
      await runQueryButton.click();
      await page.waitForTimeout(2000);

      // Verify chart is rendered
      const chartContainer = page.locator('.recharts-responsive-container');
      await expect(chartContainer).toBeVisible();
    });
  });
});
