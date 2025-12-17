import { expect, test } from '../utils/base-test';

test.describe('Dashboard', { tag: ['@dashboard'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboards');
  });

  test(
    'should persist dashboard across page reloads',
    { tag: '@full-stack' },
    async ({ page }) => {
      const uniqueDashboardName = `Test Dashboard ${Date.now()}`;

      await test.step('Create and name a new dashboard', async () => {
        const createDashboardButton = page.locator(
          '[data-testid="create-dashboard-button"]',
        );
        await expect(createDashboardButton).toBeVisible();
        await createDashboardButton.click();

        await page.waitForURL('**/dashboards**');
        await page.waitForLoadState('networkidle');

        // Wait for the dashboard name title to be visible first
        const dashboardNameTitle = page.getByRole('heading', {
          name: 'My Dashboard',
          level: 3,
        });
        await expect(dashboardNameTitle).toBeVisible({ timeout: 5000 });

        // Double-click to enter edit mode
        await dashboardNameTitle.dblclick();

        // Edit dashboard name
        const dashboardNameInput = page.locator(
          'input[placeholder="Dashboard Name"]',
        );
        await expect(dashboardNameInput).toBeVisible();
        await dashboardNameInput.fill(uniqueDashboardName);
        await page.keyboard.press('Enter');

        // Wait for the name to be saved by checking it appears as a heading
        const updatedDashboardName = page.getByRole('heading', {
          name: uniqueDashboardName,
          level: 3,
        });
        await expect(updatedDashboardName).toBeVisible({ timeout: 10000 });

        // Wait for network to settle after save
        await page.waitForLoadState('networkidle');
      });

      await test.step('Add a tile to the dashboard', async () => {
        const addNewTileButton = page.locator(
          '[data-testid="add-new-tile-button"]',
        );
        await expect(addNewTileButton).toBeVisible();
        await addNewTileButton.click();
        await page.waitForTimeout(1000);

        const chartNameInput = page.locator('[data-testid="chart-name-input"]');
        await expect(chartNameInput).toBeVisible();
        await chartNameInput.fill('Persistence Test Chart');

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

      let dashboardUrl: string;
      await test.step('Save dashboard URL', async () => {
        dashboardUrl = page.url();
        console.log(`Dashboard URL: ${dashboardUrl}`);
      });

      await test.step('Navigate away from dashboard', async () => {
        await page.goto('/search');
        await page.waitForLoadState('networkidle');
        await expect(page).toHaveURL(/.*\/search/);
      });

      await test.step('Return to dashboard and verify persistence', async () => {
        await page.goto(dashboardUrl);
        await page.waitForLoadState('networkidle');

        // Wait for dashboard to load by checking for tiles first
        const dashboardTiles = page.locator('[data-testid^="dashboard-tile-"]');
        await expect(dashboardTiles).toHaveCount(1);

        // Verify dashboard name persisted (displayed as h3 title)
        const dashboardNameHeading = page.getByRole('heading', {
          name: uniqueDashboardName,
          level: 3,
        });
        await expect(dashboardNameHeading).toBeVisible({ timeout: 5000 });

        // Verify chart still shows
        const chartContainer = page.locator('.recharts-responsive-container');
        await expect(chartContainer).toBeVisible();
      });

      await test.step('Verify dashboard appears in dashboards list', async () => {
        await page.goto('/dashboards');
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(1000);

        // Look for our dashboard in the list
        const dashboardLink = page.locator(`text="${uniqueDashboardName}"`);
        await expect(dashboardLink).toBeVisible({ timeout: 10000 });

        // Click on it and verify it loads
        await dashboardLink.click();
        await page.waitForURL('**/dashboards/**');
        await page.waitForLoadState('networkidle');

        // Verify we're on the right dashboard
        const dashboardTiles = page.locator('[data-testid^="dashboard-tile-"]');
        await expect(dashboardTiles).toHaveCount(1);
      });
    },
  );
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
      await page.waitForTimeout(1000);

      // Wait for the metric selector to appear
      const metricSelector = page.locator(
        '[data-testid="metric-name-selector"]',
      );
      await expect(metricSelector).toBeVisible({ timeout: 5000 });

      // Click to open the dropdown first
      await metricSelector.click();
      await page.waitForTimeout(500);

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
          '[data-testid="search-submit-button"], button:has-text("Search")',
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
