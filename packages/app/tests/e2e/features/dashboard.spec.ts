import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';

test.describe('Dashboard', { tag: ['@dashboard'] }, () => {
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
  });

  test(
    'should persist dashboard across page reloads',
    { tag: '@full-stack' },
    async () => {
      const uniqueDashboardName = `Test Dashboard ${Date.now()}`;

      await test.step('Create and name a new dashboard', async () => {
        // Create dashboard using page object
        await expect(dashboardPage.createButton).toBeVisible();
        await dashboardPage.createNewDashboard();

        // Edit dashboard name using page object method
        await dashboardPage.editDashboardName(uniqueDashboardName);
      });

      await test.step('Add a tile to the dashboard', async () => {
        // Open add tile modal
        await expect(dashboardPage.addNewTileButton).toBeVisible();
        await dashboardPage.addTile();

        // Create chart using chart editor component
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.createBasicChart(
          'Persistence Test Chart',
        );

        // wait for network idle
        await dashboardPage.page.waitForLoadState('networkidle');
        // Verify chart was added
        const chartContainers = dashboardPage.getChartContainers();
        await expect(chartContainers).toHaveCount(1);
      });

      let dashboardUrl: string;
      await test.step('Save dashboard URL', async () => {
        dashboardUrl = dashboardPage.page.url();
        console.log(`Dashboard URL: ${dashboardUrl}`);
      });

      await test.step('Navigate away from dashboard', async () => {
        await dashboardPage.page.goto('/search');
        await expect(dashboardPage.page).toHaveURL(/.*\/search/);
      });

      await test.step('Return to dashboard and verify persistence', async () => {
        await dashboardPage.page.goto(dashboardUrl);

        // Wait for dashboard to load by checking for tiles first
        const dashboardTiles = dashboardPage.getTiles();
        await expect(dashboardTiles).toHaveCount(1);

        // Verify dashboard name persisted (displayed as h3 title)
        const dashboardNameHeading =
          dashboardPage.getDashboardHeading(uniqueDashboardName);
        await expect(dashboardNameHeading).toBeVisible({ timeout: 5000 });

        // Verify chart still shows
        const chartContainers = dashboardPage.getChartContainers();
        await expect(chartContainers.first()).toBeVisible();
      });

      await test.step('Verify dashboard appears in dashboards list', async () => {
        await dashboardPage.goto();

        // Look for our dashboard in the list
        const dashboardLink = dashboardPage.page.locator(
          `text="${uniqueDashboardName}"`,
        );
        await expect(dashboardLink).toBeVisible({ timeout: 10000 });

        // Click on it and verify it loads
        await dashboardPage.goToDashboardByName(uniqueDashboardName);

        // Verify we're on the right dashboard
        const dashboardTiles = dashboardPage.getTiles();
        await expect(dashboardTiles).toHaveCount(1);
      });
    },
  );
  test('Comprehensive dashboard workflow - create, add tiles, configure, and test', async () => {
    test.setTimeout(60000);
    await test.step('Create new dashboard', async () => {
      await expect(dashboardPage.createButton).toBeVisible();
      await dashboardPage.createNewDashboard();
    });

    await test.step('Add first tile to dashboard', async () => {
      await expect(dashboardPage.addNewTileButton).toBeVisible();
      await dashboardPage.addTile();

      // Create basic chart
      await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      await dashboardPage.chartEditor.createBasicChart('Test Chart');

      // wait for network idle
      await dashboardPage.page.waitForLoadState('networkidle');

      // Verify chart was added
      const chartContainers = dashboardPage.getChartContainers();
      await expect(chartContainers).toHaveCount(1);
    });

    await test.step('Add second tile with Demo Metrics', async () => {
      await expect(dashboardPage.addNewTileButton).toBeVisible();
      await dashboardPage.addTile();

      // Select source and create chart with specific metric
      await expect(dashboardPage.chartEditor.source).toBeVisible();
      await dashboardPage.chartEditor.createChartWithMetric(
        'K8s CPU Chart',
        'Demo Metrics',
        'k8s.container.cpu_limit',
        'k8s.container.cpu_limit:::::::gauge',
      );
    });

    await test.step('Verify dashboard tiles and interactions', async () => {
      const dashboardTiles = dashboardPage.getTiles();
      await expect(dashboardTiles).toHaveCount(2, { timeout: 10000 });

      // Hover over first tile to reveal action buttons
      await dashboardPage.hoverOverTile(0);

      // Verify all action buttons are visible
      const buttons: Array<'edit' | 'duplicate' | 'delete' | 'alerts'> = [
        'edit',
        'duplicate',
        'delete',
        'alerts',
      ];
      for (const button of buttons) {
        const buttonLocator = dashboardPage.getTileButton(button);
        await expect(buttonLocator).toBeVisible();
      }
    });

    await test.step('Test duplicate tile', async () => {
      const dashboardTiles = dashboardPage.getTiles();
      const tileCount = await dashboardTiles.count();

      // Duplicate the first tile
      await dashboardPage.duplicateTile(0);

      // Verify tile count increased
      const dashboardTilesNow = dashboardPage.getTiles();
      await expect(dashboardTilesNow).toHaveCount(tileCount + 1);
    });

    await test.step('Update time range to Last 12 hours', async () => {
      await expect(dashboardPage.timePicker.input).toBeVisible();
      await dashboardPage.timePicker.selectRelativeTime('Last 12 hours');
    });

    await test.step('Test Live view functionality', async () => {
      // Toggle live mode on
      await dashboardPage.toggleLiveMode();

      // Turn off live mode to prevent continuous updates
      const liveButtonVisible = await dashboardPage.page
        .locator('button:has-text("Live")')
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (liveButtonVisible) {
        await dashboardPage.toggleLiveMode();
      }
    });

    await test.step('Test global dashboard filters', async () => {
      await expect(dashboardPage.filterInput).toBeVisible();
      await dashboardPage.setGlobalFilter('ServiceName:accounting');
    });

    await test.step('Delete the tile and confirm deletion', async () => {
      const dashboardTiles = dashboardPage.getTiles();
      const tileCountBefore = await dashboardTiles.count();

      // Delete first tile
      await dashboardPage.deleteTile(0);

      // Verify tile count decreased
      const tileCountNow = await dashboardTiles.count();
      expect(tileCountNow).toBe(tileCountBefore - 1);
    });
  });
});
