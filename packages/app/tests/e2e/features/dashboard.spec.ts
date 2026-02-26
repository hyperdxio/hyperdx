import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { AlertsPage } from '../page-objects/AlertsPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
} from '../utils/constants';

test.describe('Dashboard', { tag: ['@dashboard'] }, () => {
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
  });

  test(
    'should display the "temporary dashboard" banner until the dashboard is created',
    { tag: '@full-stack' },
    async () => {
      await test.step('Verify that banner is initially displayed', async () => {
        await expect(dashboardPage.temporaryDashboardBanner).toBeVisible();
      });

      await test.step('Add a tile, verify that banner is still displayed', async () => {
        await dashboardPage.addTileWithConfig('Test tile');
        await expect(dashboardPage.temporaryDashboardBanner).toBeVisible();
      });

      await test.step('Create the dashboard, verify the banner is no longer displayed', async () => {
        await dashboardPage.createNewDashboard();
        await expect(dashboardPage.temporaryDashboardBanner).toBeHidden();
      });
    },
  );

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

        // Wait for tile to appear first (wrapper element)
        const dashboardTiles = dashboardPage.getTiles();
        await expect(dashboardTiles).toHaveCount(1, { timeout: 10000 });

        // Then verify chart rendered inside (recharts can take time to initialize)
        const chartContainers = dashboardPage.getChartContainers();
        await expect(chartContainers).toHaveCount(1, { timeout: 10000 });
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

      // Verify tile was added (chart content depends on data availability)
      const dashboardTiles = dashboardPage.getTiles();
      await expect(dashboardTiles).toHaveCount(1, { timeout: 10000 });
    });

    await test.step('Add second tile with Demo Metrics', async () => {
      await expect(dashboardPage.addNewTileButton).toBeVisible();
      await dashboardPage.addTile();

      // Select source and create chart with specific metric
      await expect(dashboardPage.chartEditor.source).toBeVisible();
      await dashboardPage.chartEditor.createChartWithMetric(
        'K8s Pod CPU Chart',
        DEFAULT_METRICS_SOURCE_NAME,
        'k8s.pod.cpu.utilization',
        'k8s.pod.cpu.utilization:::::::gauge',
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

      // Verify tile count decreased (use toHaveCount for auto-waiting)
      await expect(dashboardTiles).toHaveCount(tileCountBefore - 1);
    });
  });

  test(
    'should update charts when granularity is changed',
    { tag: '@dashboard' },
    async () => {
      await test.step('Create dashboard with a time series chart', async () => {
        await dashboardPage.createNewDashboard();

        // Add a time series tile
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart(
          'Time Series Test Chart',
        );

        // Wait for chart to render
        const chartContainers = dashboardPage.getChartContainers();
        await expect(chartContainers).toHaveCount(1, { timeout: 10000 });
      });

      await test.step('Change granularity and verify UI updates', async () => {
        // Find granularity dropdown (typically labeled "Granularity" or shows current value like "Auto")
        const granularityDropdown = dashboardPage.granularityPicker;
        await expect(granularityDropdown).toBeVisible();

        // Get current value
        const currentValue = await granularityDropdown.inputValue();

        // Change to a different granularity (e.g., "1m")
        await dashboardPage.changeGranularity('1 Minute Granularity');

        // Verify the value changed
        const newValue = granularityDropdown;
        await expect(newValue).not.toHaveValue(currentValue);

        // Verify chart is still visible (validates that the change worked)
        const chartContainers = dashboardPage.getChartContainers();
        await expect(chartContainers).toHaveCount(1, { timeout: 10000 });
      });
    },
  );

  test('should warn when closing tile editor with unsaved changes', async () => {
    await dashboardPage.openNewTileEditor();
    await dashboardPage.chartEditor.setChartName('My Unsaved Chart');

    await dashboardPage.page.keyboard.press('Escape');
    await expect(dashboardPage.unsavedChangesConfirmModal).toBeAttached({
      timeout: 5000,
    });

    await dashboardPage.unsavedChangesConfirmCancelButton.click();
    await expect(dashboardPage.unsavedChangesConfirmModal).toBeHidden();
    await expect(dashboardPage.chartEditor.nameInput).toHaveValue(
      'My Unsaved Chart',
    );

    await dashboardPage.page.keyboard.press('Escape');
    await expect(dashboardPage.unsavedChangesConfirmModal).toBeAttached({
      timeout: 5000,
    });
    await dashboardPage.unsavedChangesConfirmDiscardButton.click();
    await expect(dashboardPage.chartEditor.nameInput).toBeHidden({
      timeout: 5000,
    });
  });

  test('should add and remove alert on Number type chart', async () => {
    test.setTimeout(60000);
    const alertsPage = new AlertsPage(dashboardPage.page);

    await test.step('Create new dashboard', async () => {
      await expect(dashboardPage.createButton).toBeVisible();
      await dashboardPage.createNewDashboard();
    });

    await test.step('create a Number type chart with alert', async () => {
      await expect(dashboardPage.addNewTileButton).toBeVisible();
      await dashboardPage.addTile();

      await expect(dashboardPage.chartEditor.source).toBeVisible();

      await dashboardPage.chartEditor.waitForDataToLoad();

      await dashboardPage.chartEditor.setChartType(DisplayType.Number);

      await dashboardPage.chartEditor.selectSource(DEFAULT_METRICS_SOURCE_NAME);
      await dashboardPage.chartEditor.selectMetric(
        'k8s.pod.cpu.utilization',
        'k8s.pod.cpu.utilization:::::::gauge',
      );

      await expect(dashboardPage.chartEditor.alertButton).toHaveText(
        'Add Alert',
      );
      await dashboardPage.chartEditor.clickAddAlert();
      await dashboardPage.chartEditor.addNewWebhookButton.click();

      await dashboardPage.chartEditor.webhookAlertModal.addWebhook(
        'Generic',
        'Test Webhook',
        'https://example.com/webhook',
      );

      await dashboardPage.saveTile();
    });

    await test.step('Verify dashboard tiles and interactions', async () => {
      const dashboardTiles = dashboardPage.getTiles();
      await expect(dashboardTiles).toHaveCount(1, { timeout: 10000 });

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

    let dashboardUrl: string;
    await test.step('Save dashboard URL', async () => {
      dashboardUrl = dashboardPage.page.url();
      console.log(`Dashboard URL: ${dashboardUrl}`);
    });

    await test.step('Navigate to alerts page', async () => {
      await alertsPage.goto();
    });

    await test.step('Verify alerts page loads with content', async () => {
      await expect(alertsPage.pageContainer).toBeVisible();

      // Verify there are alert cards using web-first assertion
      const alertCards = alertsPage.getAlertCards();
      await expect(alertCards).toHaveCount(1, { timeout: 10000 });
    });

    await test.step('Navigate back to dashboard page', async () => {
      await dashboardPage.page.goto(dashboardUrl);
    });

    await test.step('edit the tile to remove the alert', async () => {
      // Hover over first tile to reveal edit button
      await dashboardPage.editTile(0);

      await expect(dashboardPage.chartEditor.alertButton).toHaveText(
        'Remove Alert',
      );
      await dashboardPage.chartEditor.clickRemoveAlert();

      await dashboardPage.saveTile();
    });

    await test.step('Navigate to alerts page', async () => {
      await alertsPage.goto();
    });

    await test.step('Verify alerts page loads with no alerts', async () => {
      await expect(alertsPage.pageContainer).toBeVisible();

      // Verify there are alert cards using web-first assertion
      const alertCards = alertsPage.getAlertCards();
      await expect(alertCards).toHaveCount(0, { timeout: 10000 });
    });
  });

  test('should close tile editor without confirm when there are no unsaved changes', async () => {
    await dashboardPage.openNewTileEditor();

    await dashboardPage.page.keyboard.press('Escape');
    await expect(dashboardPage.chartEditor.nameInput).toBeHidden({
      timeout: 5000,
    });
    await expect(dashboardPage.unsavedChangesConfirmModal).toBeHidden();
  });

  test(
    'should create and populate filters',
    { tag: '@full-stack' },
    async () => {
      test.setTimeout(30000);

      await test.step('Create new dashboard', async () => {
        await expect(dashboardPage.createButton).toBeVisible();
        await dashboardPage.createNewDashboard();
      });

      await test.step('Create a table tile to filter', async () => {
        await dashboardPage.addTile();

        await dashboardPage.chartEditor.createTable({
          chartName: 'Test Table',
          sourceName: DEFAULT_LOGS_SOURCE_NAME,
          groupBy: 'ServiceName',
        });

        const accountCell = dashboardPage.page.getByTitle('accounting', {
          exact: true,
        });
        const adCell = dashboardPage.page.getByTitle('ad', { exact: true });
        await expect(accountCell).toBeVisible();
        await expect(adCell).toBeVisible();
      });

      await test.step('Add ServiceName filter to dashboard', async () => {
        await dashboardPage.openEditFiltersModal();
        await expect(dashboardPage.emptyFiltersList).toBeVisible();

        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
        );

        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();

        await dashboardPage.closeFiltersModal();
      });

      await test.step('Add MetricName filter to dashboard', async () => {
        await dashboardPage.openEditFiltersModal();
        await expect(dashboardPage.filtersList).toBeVisible();

        await dashboardPage.addFilterToDashboard(
          'Metric',
          DEFAULT_METRICS_SOURCE_NAME,
          'MetricName',
          'gauge',
        );

        await expect(dashboardPage.getFilterItemByName('Metric')).toBeVisible();

        await dashboardPage.closeFiltersModal();
      });

      await test.step('Verify tiles are filtered', async () => {
        // Select 'accounting' in Service filter
        await dashboardPage.clickFilterOption('Service', 'accounting');

        const accountCell = dashboardPage.page.getByTitle('accounting', {
          exact: true,
        });
        await expect(accountCell).toBeVisible();

        // 'ad' ServiceName row should be filtered out
        const adCell = dashboardPage.page.getByTitle('ad', { exact: true });
        await expect(adCell).toHaveCount(0);
      });

      await test.step('Verify metric filter is populated', async () => {
        await dashboardPage.clickFilterOption(
          'Metric',
          'container.cpu.utilization',
        );
      });

      await test.step('Delete a filter and verify it is removed', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.deleteFilterFromDashboard('Metric');

        // Service filter should still be visible
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();

        // Metric filter should be gone
        await expect(dashboardPage.getFilterItemByName('Metric')).toHaveCount(
          0,
        );
      });
    },
  );

  test(
    'should save and restore query and filter values',
    { tag: '@full-stack' },
    async () => {
      const testQuery = 'level:error';
      let dashboardUrl: string;

      await test.step('Create dashboard with chart', async () => {
        await dashboardPage.createNewDashboard();

        // Add a tile so dashboard is saveable
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart('Test Chart');

        const chartContainers = dashboardPage.getChartContainers();
        await expect(chartContainers).toHaveCount(1, { timeout: 10000 });

        // Save dashboard URL for later
        dashboardUrl = dashboardPage.page.url();
      });

      await test.step('Enter query in search bar', async () => {
        const searchInput = dashboardPage.searchInput;
        await expect(searchInput).toBeVisible();
        await searchInput.fill(testQuery);
      });

      await test.step('Click save query button', async () => {
        await dashboardPage.saveQueryAndFiltersAsDefault();

        // Wait for success notification
        const notification = dashboardPage.page.locator(
          'text=/Filter query and dropdown values/i',
        );
        await expect(notification).toBeVisible({ timeout: 5000 });
      });

      await test.step('Navigate away from dashboard', async () => {
        await dashboardPage.page.goto('/search');
        await expect(dashboardPage.page).toHaveURL(/.*\/search/);
      });

      await test.step('Return to dashboard and verify query restored', async () => {
        await dashboardPage.page.goto(dashboardUrl);

        // Wait for dashboard controls to load
        await expect(
          dashboardPage.page.getByTestId('dashboard-page'),
        ).toBeVisible({ timeout: 10000 });
        await expect(dashboardPage.searchInput).toBeVisible({ timeout: 10000 });

        // Verify saved query is restored in search input
        const searchInput = dashboardPage.searchInput;
        await expect(searchInput).toHaveValue(testQuery);
      });

      await test.step('Clear URL params and verify query persists', async () => {
        // Extract dashboard ID and navigate without query params
        const dashboardId = dashboardUrl.split('/').pop()?.split('?')[0];
        await dashboardPage.page.goto(`/dashboards/${dashboardId}`);

        // Verify saved query still loads
        const searchInput = dashboardPage.searchInput;
        await expect(searchInput).toHaveValue(testQuery);
      });
    },
  );

  test(
    'should handle URL query params overriding saved query',
    { tag: '@full-stack' },
    async () => {
      const savedQuery = 'level:error';
      const urlQuery = 'status:active';
      let dashboardId: string;

      await test.step('Create dashboard and save query', async () => {
        await dashboardPage.createNewDashboard();

        // Add a tile
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart('Test Chart');

        // Enter and save query
        const searchInput = dashboardPage.searchInput;
        await searchInput.fill(savedQuery);

        await dashboardPage.saveQueryAndFiltersAsDefault();

        // Wait for save confirmation
        await dashboardPage.page.waitForTimeout(1000);

        // Extract dashboard ID
        const url = dashboardPage.page.url();
        dashboardId = url.split('/').pop()?.split('?')[0] || '';
      });

      await test.step('Navigate with URL query param', async () => {
        // Navigate to dashboard with URL query param
        await dashboardPage.page.goto(
          `/dashboards/${dashboardId}?where=${encodeURIComponent(urlQuery)}`,
        );

        // Wait for dashboard controls to load
        await expect(
          dashboardPage.page.getByTestId('dashboard-page'),
        ).toBeVisible({ timeout: 10000 });
        await expect(dashboardPage.searchInput).toBeVisible({ timeout: 10000 });

        // Verify URL query takes precedence over saved query
        const searchInput = dashboardPage.searchInput;
        await expect(searchInput).toHaveValue(urlQuery);
        await expect(searchInput).not.toHaveValue(savedQuery);
      });

      await test.step('Navigate without URL params to verify saved query', async () => {
        await dashboardPage.page.goto(`/dashboards/${dashboardId}`);

        // Verify saved query is restored when no URL params
        const searchInput = dashboardPage.searchInput;
        await expect(searchInput).toHaveValue(savedQuery);
      });
    },
  );

  test(
    'should clear saved query when WHERE input is cleared and saved',
    { tag: '@full-stack' },
    async () => {
      const testQuery = 'level:warn';
      let dashboardUrl: string;

      await test.step('Create dashboard with chart', async () => {
        await dashboardPage.createNewDashboard();

        // Add a tile so dashboard is saveable
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart('Test Chart');

        const chartContainers = dashboardPage.getChartContainers();
        await expect(chartContainers).toHaveCount(1, { timeout: 10000 });

        // Save dashboard URL for later
        dashboardUrl = dashboardPage.page.url();
      });

      await test.step('Enter and save query', async () => {
        const searchInput = dashboardPage.searchInput;
        await expect(searchInput).toBeVisible();
        await searchInput.fill(testQuery);

        await dashboardPage.saveQueryAndFiltersAsDefault();

        // Wait for success notification
        const notification = dashboardPage.page.locator(
          'text=/Filter query and dropdown values/i',
        );
        await expect(notification).toBeVisible({ timeout: 5000 });
      });

      await test.step('Navigate away and verify query persists', async () => {
        await dashboardPage.page.goto('/search');
        await dashboardPage.page.goto(dashboardUrl);

        const searchInput = dashboardPage.searchInput;
        await expect(searchInput).toHaveValue(testQuery);
      });

      await test.step('Clear the query and save', async () => {
        const searchInput = dashboardPage.searchInput;
        await searchInput.clear();

        await dashboardPage.saveQueryAndFiltersAsDefault();

        // Wait for success notification
        const notification = dashboardPage.page.locator(
          'text=/Filter query and dropdown values/i',
        );
        await expect(notification).toBeVisible({ timeout: 5000 });
      });

      await test.step('Navigate away and verify query is cleared', async () => {
        await dashboardPage.page.goto('/search');

        // Extract dashboard ID and navigate back
        const dashboardId = dashboardUrl.split('/').pop()?.split('?')[0];
        await dashboardPage.page.goto(`/dashboards/${dashboardId}`);

        // Wait for dashboard to load
        const chartContainers = dashboardPage.getChartContainers();
        await expect(chartContainers).toHaveCount(1, { timeout: 10000 });

        // Verify search input is empty (saved query was removed)
        const searchInput = dashboardPage.searchInput;
        await expect(searchInput).toHaveValue('');
      });
    },
  );
});
