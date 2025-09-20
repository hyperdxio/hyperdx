import { expect, test } from '../utils/base-test';

test.describe('Dashboard', { tag: ['@dashboard'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboards');
  });
  test('Comprehensive dashboard workflow - create, add tiles, configure, and test', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await test.step('Create new dashboard', async () => {
      const createDashboardButton = page.locator(
        '[data-testid="create-dashboard-button"]',
      );
      await expect(createDashboardButton).toBeVisible();
      await createDashboardButton.click();

      await page.waitForURL('**/dashboards**');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    });

    await test.step('Add first tile to dashboard', async () => {
      const addNewTileButton = page.locator(
        '[data-testid="add-new-tile-button"]',
      );
      await expect(addNewTileButton).toBeVisible();
      await addNewTileButton.click();
      await page.waitForTimeout(1000);

      const chartNameInput = page.locator('[data-testid="chart-name-input"]');
      await expect(chartNameInput).toBeVisible();
      await chartNameInput.fill('Test Chart');

      const runQueryButton = page.locator(
        '[data-testid="chart-run-query-button"]',
      );
      await expect(runQueryButton).toBeVisible();
      await runQueryButton.click();
      await page.waitForTimeout(2000);

      const saveButton = page.locator('[data-testid="chart-save-button"]');
      await expect(saveButton).toBeVisible();
      await saveButton.click();
      await page.waitForTimeout(2000);

      const chartContainer = page.locator('.recharts-responsive-container');
      await expect(chartContainer).toHaveCount(1);
    });

    await test.step('Add second tile with Demo Metrics', async () => {
      const addSecondTileButton = page.locator(
        '[data-testid="add-new-tile-button"]',
      );
      await expect(addSecondTileButton).toBeVisible();
      await addSecondTileButton.click();
      await page.waitForTimeout(1000);

      const sourceSelector = page.locator('[data-testid="source-selector"]');
      await expect(sourceSelector).toBeVisible();
      await sourceSelector.click();
      await page.waitForTimeout(500);

      const demoMetricsOption = page.locator('text=Demo Metrics');
      await expect(demoMetricsOption).toBeVisible();
      await demoMetricsOption.click();

      const metricSelector = page.locator(
        'input[placeholder*="metric"], input[placeholder*="Select a metric"]',
      );
      await expect(metricSelector).toBeVisible();

      // Click to open the dropdown first
      await metricSelector.click();

      // Type the metric name to filter options
      await metricSelector.fill('k8s.container.cpu_limit');
      await page.waitForTimeout(1500);

      // Wait for and click the specific metric option we want
      const targetMetricOption = page.locator(
        '[data-combobox-option="true"][value="k8s.container.cpu_limit:::::::gauge"]',
      );
      await expect(targetMetricOption).toBeVisible({ timeout: 5000 });
      await targetMetricOption.click();

      const runSecondQueryButton = page.locator(
        '[data-testid="chart-run-query-button"]',
      );
      await expect(runSecondQueryButton).toBeVisible();
      await runSecondQueryButton.click();
      await page.waitForTimeout(2000);

      const saveSecondButton = page.locator(
        '[data-testid="chart-save-button"]',
      );
      await expect(saveSecondButton).toBeVisible();
      await saveSecondButton.click();
      await page.waitForTimeout(2000);
    });

    await test.step('Verify dashboard tiles and interactions', async () => {
      const dashboardTiles = page.locator('[data-testid^="dashboard-tile-"]');
      const tileCount = await dashboardTiles.count();
      await expect(tileCount).toBeGreaterThan(0);

      const firstTile = dashboardTiles.first();
      await expect(firstTile).toBeVisible();
      await firstTile.hover();
      await page.waitForTimeout(500);

      const buttons = [
        'tile-edit-button-',
        'tile-duplicate-button-',
        'tile-delete-button-',
        'tile-alerts-button-',
      ];
      for (const button of buttons) {
        const buttonLocator = page.locator(`[data-testid^="${button}"]`);
        await expect(buttonLocator).toBeVisible();
      }
    });

    await test.step('Test duplicate tile', async () => {
      const dashboardTiles = page.locator('[data-testid^="dashboard-tile-"]');
      const tileCount = await dashboardTiles.count();
      const firstTile = dashboardTiles.first();
      await expect(firstTile).toBeVisible();
      await firstTile.hover();
      await page.waitForTimeout(500);

      const duplicateButton = page
        .locator(`[data-testid^="tile-duplicate-button-"]`)
        .first();
      await expect(duplicateButton).toBeVisible();
      await duplicateButton.click();
      await page.waitForTimeout(500);

      const confirmButton = page.locator(
        '[data-testid="confirm-confirm-button"]',
      );
      await expect(confirmButton).toBeVisible();
      await confirmButton.click();
      await page.waitForTimeout(2000);

      const dashboardTilesNow = page.locator(
        '[data-testid^="dashboard-tile-"]',
      );
      const tileCountNow = await dashboardTilesNow.count();
      await expect(tileCountNow).toBeGreaterThan(tileCount);
    });

    await test.step('Update time range to Last 12 hours', async () => {
      const timePickerInput = page.locator('[data-testid="time-picker-input"]');
      await expect(timePickerInput).toBeVisible();
      await timePickerInput.click();
      await page.waitForTimeout(500);

      const last12HoursOption = page.locator('text=Last 12 hours');
      await expect(last12HoursOption).toBeVisible();
      await last12HoursOption.click();
      await page.waitForTimeout(2000);
    });

    await test.step('Test Live view functionality', async () => {
      const liveButton = page.locator(
        'button:has-text("Live"), [data-testid*="live"]',
      );
      await expect(liveButton).toBeVisible();
      await liveButton.click();
      await page.waitForTimeout(2000);

      // Turn off live mode to prevent continuous updates that can interfere with the test
      const liveButtonAfterClick = page.locator(
        'button:has-text("Live"), [data-testid*="live"]',
      );
      if (await liveButtonAfterClick.isVisible({ timeout: 1000 })) {
        await liveButtonAfterClick.click();
        await page.waitForTimeout(1000);
      }
    });

    await test.step('Test global dashboard filters', async () => {
      const searchInput = page.locator('[data-testid="search-input"]');
      await expect(searchInput).toBeVisible();
      await searchInput.fill('ServiceName:accounting');

      const runButton = page
        .locator(
          '[data-testid="search-submit-button"], button:has-text("Search"), i.bi-play',
        )
        .first();
      await expect(runButton).toBeVisible();
      await runButton.click();
      await page.waitForTimeout(1000);
    });

    await test.step('Delete the tile and confirm deletion', async () => {
      const dashboardTiles = page.locator('[data-testid^="dashboard-tile-"]');
      const tileCountBefore = await dashboardTiles.count();

      const firstTile = dashboardTiles.first();
      await expect(firstTile).toBeVisible();
      await firstTile.hover();
      await page.waitForTimeout(500);

      const deleteButton = page
        .locator('[data-testid^="tile-delete-button-"]')
        .first();
      await expect(deleteButton).toBeVisible();
      await deleteButton.click();
      await page.waitForTimeout(1000);

      const confirmButton = page.locator(
        '[data-testid="confirm-confirm-button"]',
      );
      await expect(confirmButton).toBeVisible();
      await confirmButton.click();
      await page.waitForTimeout(2000);
      const tileCountNow = await dashboardTiles.count();
      expect(tileCountNow).toBe(tileCountBefore - 1);
    });
  });
});
