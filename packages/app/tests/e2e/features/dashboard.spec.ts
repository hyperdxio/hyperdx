import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { AlertsPage } from '../page-objects/AlertsPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { DashboardsListPage } from '../page-objects/DashboardsListPage';
import { getApiUrl, getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../utils/constants';
import { runMongoshScript } from '../utils/db-helpers';
import { getSqlEditor } from '../utils/locators';

test.describe('Dashboard', { tag: ['@dashboard'] }, () => {
  let dashboardPage: DashboardPage;
  let dashboardsListPage: DashboardsListPage;

  test.beforeEach(async ({ page }) => {
    dashboardPage = new DashboardPage(page);
    dashboardsListPage = new DashboardsListPage(page);
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

  test('should persist dashboard across page reloads', {}, async () => {
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
      await expect(dashboardPage.addButton).toBeVisible();
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
      await dashboardsListPage.goto();

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
  });

  test('Comprehensive dashboard workflow - create, add tiles, configure, and test', async () => {
    test.setTimeout(60000);

    await test.step('Create new dashboard', async () => {
      await expect(dashboardPage.createButton).toBeVisible();
      await dashboardPage.createNewDashboard();
    });

    await test.step('Add first tile to dashboard', async () => {
      await expect(dashboardPage.addButton).toBeVisible();
      await dashboardPage.addTile();

      // Create basic chart
      await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      await dashboardPage.chartEditor.createBasicChart('Test Chart');

      // Verify tile was added (chart content depends on data availability)
      const dashboardTiles = dashboardPage.getTiles();
      await expect(dashboardTiles).toHaveCount(1, { timeout: 10000 });
    });

    await test.step('Add second tile with Demo Metrics', async () => {
      await expect(dashboardPage.addButton).toBeVisible();
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

      // The alert affordance lives directly in the always-visible tile header.
      await dashboardPage.hoverOverTile(0);
      await expect(dashboardPage.getTileButton('alerts')).toBeVisible();

      // Edit / duplicate / delete now live inside the tile actions (kebab) menu.
      await dashboardPage.openTileActionsMenu(0);
      const menuButtons: Array<'edit' | 'duplicate' | 'delete'> = [
        'edit',
        'duplicate',
        'delete',
      ];
      for (const button of menuButtons) {
        await expect(dashboardPage.getTileButton(button)).toBeVisible();
      }

      // Close the menu so it doesn't intercept subsequent interactions.
      await dashboardPage.page.keyboard.press('Escape');
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

  test('should warn when closing tile editor with unsaved display settings changes', async () => {
    await dashboardPage.openNewTileEditor();

    // Open the Display Settings drawer
    await dashboardPage.page.getByTestId('display-settings-button').click();
    const applyButton = dashboardPage.page.getByTestId(
      'display-settings-apply-button',
    );
    await expect(applyButton).toBeVisible({ timeout: 5000 });

    // Toggle a checkbox via its label
    await dashboardPage.page
      .locator('label', { hasText: 'Compare to Previous Period' })
      .click();

    // Apply and wait for the drawer to close
    await applyButton.click();
    await expect(applyButton).toBeHidden({ timeout: 5000 });

    // Try to close — should show unsaved changes confirm
    await dashboardPage.page.keyboard.press('Escape');
    await expect(dashboardPage.unsavedChangesConfirmModal).toBeAttached({
      timeout: 5000,
    });
  });

  test('should add and remove alert on Number type chart', async () => {
    test.setTimeout(60000);
    const ts = Date.now();
    const tileName = `E2E Alert Number Chart ${ts}`;
    const webhookUrl = `https://example.com/number-chart-${ts}`;
    const alertsPage = new AlertsPage(dashboardPage.page);

    await test.step('Create new dashboard', async () => {
      await expect(dashboardPage.createButton).toBeVisible();
      await dashboardPage.createNewDashboard();
    });

    await test.step('create a Number type chart with alert', async () => {
      await expect(dashboardPage.addButton).toBeVisible();
      await dashboardPage.addTile();

      await expect(dashboardPage.chartEditor.source).toBeVisible();

      await dashboardPage.chartEditor.waitForDataToLoad();

      await dashboardPage.chartEditor.setChartType(DisplayType.Number);

      await dashboardPage.chartEditor.selectSource(DEFAULT_METRICS_SOURCE_NAME);
      await dashboardPage.chartEditor.selectMetric(
        'k8s.pod.cpu.utilization',
        'k8s.pod.cpu.utilization:::::::gauge',
      );

      await dashboardPage.chartEditor.setChartName(tileName);

      await expect(dashboardPage.chartEditor.alertButton).toHaveText(
        'Add Alert',
      );
      await dashboardPage.chartEditor.clickAddAlert();
      await dashboardPage.chartEditor.addNewWebhookButton.click();

      await dashboardPage.chartEditor.webhookAlertModal.addWebhook(
        'Generic',
        `Test Webhook ${ts}`,
        webhookUrl,
      );

      await dashboardPage.saveTile();
    });

    await test.step('Verify dashboard tiles and interactions', async () => {
      const dashboardTiles = dashboardPage.getTiles();
      await expect(dashboardTiles).toHaveCount(1, { timeout: 10000 });

      // The alert affordance lives directly in the always-visible tile header.
      await dashboardPage.hoverOverTile(0);
      await expect(dashboardPage.getTileButton('alerts')).toBeVisible();

      // Edit / duplicate / delete now live inside the tile actions (kebab) menu.
      await dashboardPage.openTileActionsMenu(0);
      const menuButtons: Array<'edit' | 'duplicate' | 'delete'> = [
        'edit',
        'duplicate',
        'delete',
      ];
      for (const button of menuButtons) {
        await expect(dashboardPage.getTileButton(button)).toBeVisible();
      }

      // Close the menu so it doesn't intercept subsequent interactions.
      await dashboardPage.page.keyboard.press('Escape');
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
      await expect(
        alertsPage.pageContainer
          .getByRole('link')
          .filter({ hasText: tileName }),
      ).toBeVisible({ timeout: 10000 });
    });

    await test.step('Navigate back to dashboard page', async () => {
      await dashboardPage.page.goto(dashboardUrl);
    });

    await test.step('edit the tile to remove the alert', async () => {
      // Hover over first tile to reveal edit button
      await dashboardPage.editTile(0);

      await dashboardPage.chartEditor.clickRemoveAlert();

      await dashboardPage.saveTile();
    });

    await test.step('Navigate to alerts page', async () => {
      await alertsPage.goto();
    });

    await test.step('Verify alerts page loads with no alerts', async () => {
      await expect(alertsPage.pageContainer).toBeVisible();
      await expect(
        alertsPage.pageContainer
          .getByRole('link')
          .filter({ hasText: tileName }),
      ).toBeHidden({ timeout: 10000 });
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

  test('should create and populate filters', {}, async () => {
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

      await expect(dashboardPage.getFilterItemByName('Service')).toBeVisible();

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
      await expect(dashboardPage.getFilterItemByName('Service')).toBeVisible();

      // Metric filter should be gone
      await expect(dashboardPage.getFilterItemByName('Metric')).toHaveCount(0);
    });
  });

  test(
    'should allow typing a freeform filter value not present in the dropdown',
    {},
    async () => {
      test.setTimeout(30000);
      const freeformValue = 'nonexistent-service-e2e';

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

        const accountingCell = dashboardPage.page.getByTitle('accounting', {
          exact: true,
        });
        await expect(accountingCell).toBeVisible();
      });

      await test.step('Add Service filter to dashboard', async () => {
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

      await test.step("Type a value not present in the filter's dropdown", async () => {
        await dashboardPage.typeFilterSearchValue('Service', freeformValue);
        await expect(dashboardPage.getFilterEmptyDropdownState()).toBeVisible();
      });

      await test.step('Press Enter to add the typed value as a pill', async () => {
        await dashboardPage.submitFilterSearchValue('Service');

        await expect(
          dashboardPage.getFilterPill('Service', freeformValue),
        ).toBeVisible();
        await expect(dashboardPage.getFilterSearchInput('Service')).toHaveValue(
          '',
        );

        // Close the dropdown before asserting table contents below.
        await dashboardPage.page.keyboard.press('Escape');
      });

      await test.step('Verify the freeform value filters the table', async () => {
        const accountingCell = dashboardPage.page.getByTitle('accounting', {
          exact: true,
        });
        await expect(accountingCell).toHaveCount(0);
      });

      await test.step('Remove the freeform value and verify the table is unfiltered again', async () => {
        await dashboardPage.removeLastFilterPillViaBackspace('Service');

        await expect(
          dashboardPage.getFilterPill('Service', freeformValue),
        ).toHaveCount(0);

        const accountingCell = dashboardPage.page.getByTitle('accounting', {
          exact: true,
        });
        await expect(accountingCell).toBeVisible();
      });
    },
  );

  test(
    'should scope a filter to a specific source via "Applies to sources"',
    {},
    async () => {
      test.setTimeout(45000);

      await test.step('Create new dashboard', async () => {
        await expect(dashboardPage.createButton).toBeVisible();
        await dashboardPage.createNewDashboard();
      });

      await test.step('Add a logs table tile', async () => {
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createTable({
          chartName: 'Logs Table',
          sourceName: DEFAULT_LOGS_SOURCE_NAME,
          groupBy: 'ServiceName',
        });
      });

      await test.step('Add a traces table tile', async () => {
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createTable({
          chartName: 'Traces Table',
          sourceName: DEFAULT_TRACES_SOURCE_NAME,
          groupBy: 'SpanName',
        });
      });

      await test.step('Add a Span filter scoped to the trace source', async () => {
        await dashboardPage.openEditFiltersModal();
        await expect(dashboardPage.emptyFiltersList).toBeVisible();
        await dashboardPage.addFilterToDashboard(
          'SpanName',
          DEFAULT_TRACES_SOURCE_NAME,
          'SpanName',
          undefined,
          [DEFAULT_TRACES_SOURCE_NAME],
        );
        await expect(
          dashboardPage.getFilterItemByName('SpanName'), // Not a valid column for the logs table
        ).toBeVisible();
        await dashboardPage.closeFiltersModal();
      });

      await test.step('Filter label tooltip shows the scoped count', async () => {
        const label = dashboardPage.getFilterLabel('SpanName');
        await expect(label).toBeVisible();
        await label.hover();
        // New filters are variable-enabled by default while the feature is on,
        // so both effects are described.
        await expect(
          dashboardPage.page.getByText(
            'Filters 1 source, available as variable ($SpanName)',
          ),
        ).toBeVisible();
      });

      await test.step('Selecting a value filters only the traces tile', async () => {
        await dashboardPage.clickFilterOption('SpanName', 'GET /api/logs');

        // Traces tile: only the "GET /api/logs" span should remain.
        const tracesAccountingCell = dashboardPage.page.getByTitle(
          'GET /api/logs',
          {
            exact: true,
          },
        );
        await expect(tracesAccountingCell).toBeVisible();

        // The logs tile must still render its rows — the filter scope
        // excluded it, so the dropdown value should not have affected it.
        // (Even if the traces source has no `SpanName` column, the tile
        // must not be broken by an inapplicable WHERE.)
        const logsTile = dashboardPage.getTile(0);
        await expect(logsTile.locator('table tbody tr').first()).toBeVisible({
          timeout: 15000,
        });
      });
    },
  );

  test(
    'filter label tooltip shows "all sources" when scope is empty',
    {},
    async () => {
      await dashboardPage.createNewDashboard();
      await dashboardPage.addTile();
      await dashboardPage.chartEditor.createTable({
        chartName: 'Logs Table',
        sourceName: DEFAULT_LOGS_SOURCE_NAME,
        groupBy: 'ServiceName',
      });

      await dashboardPage.openEditFiltersModal();
      await dashboardPage.addFilterToDashboard(
        'Service',
        DEFAULT_LOGS_SOURCE_NAME,
        'ServiceName',
      );
      await dashboardPage.closeFiltersModal();

      const label = dashboardPage.getFilterLabel('Service');
      await label.hover();
      await expect(
        dashboardPage.page.getByText(
          'Filters all sources, available as variable ($Service)',
        ),
      ).toBeVisible();
    },
  );

  test('should configure a filter as a dashboard variable', {}, async () => {
    test.setTimeout(60000);

    await test.step('Create a dashboard with a tile', async () => {
      await dashboardPage.createNewDashboard();
      await dashboardPage.addTile();
      await dashboardPage.chartEditor.createTable({
        chartName: 'Logs Table',
        sourceName: DEFAULT_LOGS_SOURCE_NAME,
        groupBy: 'ServiceName',
      });
    });

    await test.step('Variable name is derived from the filter name', async () => {
      await dashboardPage.openEditFiltersModal();
      await dashboardPage.addFiltersButton.click();

      // Enabled by default for new filters while the feature is on.
      await expect(dashboardPage.broadcastFilterCheckbox).toBeChecked();
      await expect(dashboardPage.variableEnabledCheckbox).toBeChecked();

      await dashboardPage.page
        .getByTestId('filter-name-input')
        .fill('Service Name');
      await expect(dashboardPage.variableNameInput).toHaveValue('Service_Name');
    });

    await test.step('Editing the variable name stops the auto-derivation', async () => {
      await dashboardPage.variableNameInput.fill('svc');
      await dashboardPage.page
        .getByTestId('filter-name-input')
        .fill('Service Name Renamed');
      await expect(dashboardPage.variableNameInput).toHaveValue('svc');
    });

    await test.step('Unchecking broadcast hides the source scope', async () => {
      await expect(dashboardPage.appliesToSourceSelector).toBeVisible();
      await dashboardPage.broadcastFilterCheckbox.uncheck();
      await expect(dashboardPage.appliesToSourceSelector).toBeHidden();
      await dashboardPage.broadcastFilterCheckbox.check();
      await expect(dashboardPage.appliesToSourceSelector).toBeVisible();
    });

    await test.step('Unchecking the variable hides its name', async () => {
      await dashboardPage.variableEnabledCheckbox.uncheck();
      await expect(dashboardPage.variableNameInput).toBeHidden();
      await dashboardPage.variableEnabledCheckbox.check();
      await expect(dashboardPage.variableNameInput).toBeVisible();
    });

    await test.step('Settings survive a save and reopen', async () => {
      await dashboardPage.filtersSourceSelector.click();
      await dashboardPage.page
        .getByRole('option', { name: DEFAULT_LOGS_SOURCE_NAME, exact: true })
        .click();
      const editor = getSqlEditor(dashboardPage.page, 'expression');
      await editor.click();
      await dashboardPage.page.keyboard.type('ServiceName');
      await dashboardPage.page.getByTestId('save-filter-button').click();

      const savedFilterItem = dashboardPage.getFilterItemByName(
        'Service Name Renamed',
      );
      await expect(savedFilterItem).toBeVisible();
      // The list row shows the token the filter is referenced by, next to its name.
      await expect(savedFilterItem).toContainText('($svc)');

      await dashboardPage.page
        .getByTestId('edit-filter-button-Service Name Renamed')
        .click();

      await expect(dashboardPage.variableEnabledCheckbox).toBeChecked();
      await expect(dashboardPage.variableNameInput).toHaveValue('svc');
    });

    await test.step('Renaming the filter keeps the stored variable name', async () => {
      await dashboardPage.page
        .getByTestId('filter-name-input')
        .fill('Service Name Again');
      await expect(dashboardPage.variableNameInput).toHaveValue('svc');
      await dashboardPage.page.getByTestId('save-filter-button').click();
      await expect(
        dashboardPage.getFilterItemByName('Service Name Again'),
      ).toBeVisible();
    });

    await test.step('A duplicate variable name is rejected', async () => {
      await dashboardPage.addFiltersButton.click();
      await dashboardPage.page.getByTestId('filter-name-input').fill('Other');
      await dashboardPage.filtersSourceSelector.click();
      await dashboardPage.page
        .getByRole('option', { name: DEFAULT_LOGS_SOURCE_NAME, exact: true })
        .click();
      const editor = getSqlEditor(dashboardPage.page, 'expression');
      await editor.click();
      await dashboardPage.page.keyboard.type('ServiceName');
      await dashboardPage.variableNameInput.fill('svc');
      await dashboardPage.page.getByTestId('save-filter-button').click();

      await expect(
        dashboardPage.page.getByText(
          'This variable name is used by another filter on this dashboard (Service Name Again)',
        ),
      ).toBeVisible();
      // The form stays open rather than persisting the clashing name.
      await expect(dashboardPage.variableNameInput).toBeVisible();
    });
  });

  test(
    'should refuse to save a filter with neither broadcast nor variable enabled',
    {},
    async () => {
      test.setTimeout(60000);

      const modeError =
        'A filter must broadcast its value, be available as a variable, or both';

      await test.step('Create a dashboard with a tile', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createTable({
          chartName: 'Logs Table',
          sourceName: DEFAULT_LOGS_SOURCE_NAME,
          groupBy: 'ServiceName',
        });
      });

      await test.step('Fill in a new filter', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFiltersButton.click();
        await dashboardPage.page
          .getByTestId('filter-name-input')
          .fill('Service');
        await dashboardPage.filtersSourceSelector.click();
        await dashboardPage.page
          .getByRole('option', { name: DEFAULT_LOGS_SOURCE_NAME, exact: true })
          .click();
        const editor = getSqlEditor(dashboardPage.page, 'expression');
        await editor.click();
        await dashboardPage.page.keyboard.type('ServiceName');

        // Both modes are on by default, so nothing is wrong yet.
        await expect(dashboardPage.page.getByText(modeError)).toHaveCount(0);
      });

      await test.step('Turning off only one mode is fine', async () => {
        await dashboardPage.broadcastFilterCheckbox.uncheck();
        await expect(dashboardPage.page.getByText(modeError)).toHaveCount(0);

        await dashboardPage.broadcastFilterCheckbox.check();
        await dashboardPage.variableEnabledCheckbox.uncheck();
        await expect(dashboardPage.page.getByText(modeError)).toHaveCount(0);
      });

      await test.step('Turning off both surfaces the error before saving', async () => {
        await dashboardPage.broadcastFilterCheckbox.uncheck();
        await expect(dashboardPage.page.getByText(modeError)).toBeVisible();
      });

      await test.step('Saving is blocked while both are off', async () => {
        await dashboardPage.page.getByTestId('save-filter-button').click();

        // The form stays open on the unsaved filter.
        await expect(dashboardPage.page.getByText(modeError)).toBeVisible();
        await expect(
          dashboardPage.page.getByTestId('filter-name-input'),
        ).toHaveValue('Service');
        await expect(dashboardPage.getFilterItemByName('Service')).toHaveCount(
          0,
        );
      });

      await test.step('Re-enabling a mode clears the error and saves', async () => {
        await dashboardPage.variableEnabledCheckbox.check();
        await expect(dashboardPage.page.getByText(modeError)).toHaveCount(0);

        await dashboardPage.page.getByTestId('save-filter-button').click();
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();
      });

      await test.step('The same rule applies when editing a saved filter', async () => {
        await dashboardPage.page
          .getByTestId('edit-filter-button-Service')
          .click();
        await dashboardPage.variableEnabledCheckbox.uncheck();
        await expect(dashboardPage.page.getByText(modeError)).toBeVisible();

        await dashboardPage.page.getByTestId('save-filter-button').click();
        await expect(dashboardPage.page.getByText(modeError)).toBeVisible();
      });
    },
  );

  test(
    'should not broadcast a filter to any tile when broadcast is disabled',
    {},
    async () => {
      test.setTimeout(60000);

      const accountingCell = () =>
        dashboardPage.page.getByTitle('accounting', { exact: true });
      const adCell = () => dashboardPage.page.getByTitle('ad', { exact: true });

      await test.step('Create a dashboard with a logs tile and a traces tile', async () => {
        await dashboardPage.createNewDashboard();

        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createTable({
          chartName: 'Logs Table',
          sourceName: DEFAULT_LOGS_SOURCE_NAME,
          groupBy: 'ServiceName',
        });

        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createTable({
          chartName: 'Traces Table',
          sourceName: DEFAULT_TRACES_SOURCE_NAME,
          groupBy: 'SpanName',
        });

        await expect(accountingCell()).toBeVisible();
        await expect(adCell()).toBeVisible();
      });

      await test.step('Add a Service filter with broadcast disabled', async () => {
        await dashboardPage.openEditFiltersModal();
        await expect(dashboardPage.emptyFiltersList).toBeVisible();

        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { isBroadcastEnabled: false },
        );

        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();
        // The list row drops the "applies to" line entirely for a filter that
        // broadcasts to nothing.
        await expect(
          dashboardPage.page.getByTestId('dashboard-filter-applies-to-Service'),
        ).toHaveCount(0);

        await dashboardPage.closeFiltersModal();
      });

      await test.step('Filter label tooltip drops the broadcast half', async () => {
        // Broadcast off, variable still on (the default for a new filter while
        // the feature is enabled), so only the variable effect is described.
        const label = dashboardPage.getFilterLabel('Service');
        await expect(label).toBeVisible();
        await label.hover();
        await expect(
          dashboardPage.page.getByText('Available as variable ($Service)'),
        ).toBeVisible();
      });

      await test.step('Selecting a value leaves every tile unfiltered', async () => {
        await dashboardPage.clickFilterOption('Service', 'accounting');
        await dashboardPage.page.keyboard.press('Escape');

        // Both service rows survive: the selection was never turned into a
        // WHERE condition on the logs tile...
        await expect(accountingCell()).toBeVisible();
        await expect(adCell()).toBeVisible();

        // ...and the traces tile, which has no ServiceName-scoped filter
        // either, still renders its rows rather than erroring.
        const tracesTile = dashboardPage.getTile(1);
        await expect(tracesTile.locator('table tbody tr').first()).toBeVisible({
          timeout: 15000,
        });
      });

      await test.step('Re-enabling broadcast applies the already-selected value', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.setFilterBroadcastEnabled('Service', true);
        await dashboardPage.closeFiltersModal();

        await expect(accountingCell()).toBeVisible();
        await expect(adCell()).toHaveCount(0);

        const label = dashboardPage.getFilterLabel('Service');
        await label.hover();
        await expect(
          dashboardPage.page.getByText(
            'Filters all sources, available as variable ($Service)',
          ),
        ).toBeVisible();
      });

      await test.step('Disabling broadcast again releases the tiles', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.setFilterBroadcastEnabled('Service', false);
        await dashboardPage.closeFiltersModal();

        await expect(accountingCell()).toBeVisible();
        await expect(adCell()).toBeVisible();
      });

      await test.step('A filter with neither mode warns that it does nothing', async () => {
        // Written straight to Mongo: the API and the form both refuse this
        // state now, so the only way to hold it is to predate that rule.
        const dashboardId = dashboardPage.getCurrentDashboardId();
        const out = runMongoshScript(
          [
            "use('hyperdx-e2e');",
            'print(JSON.stringify(db.dashboards.updateOne(',
            `  { _id: ObjectId(${JSON.stringify(dashboardId)}) },`,
            '  { $set: { "filters.0.isVariableEnabled": false } }',
            ')));',
          ].join('\n'),
        );
        expect(out).toContain('"matchedCount":1');
        expect(out).toContain('"modifiedCount":1');

        await dashboardPage.gotoDashboard(dashboardId);

        // The question-mark affordance is replaced by a warning.
        await expect(dashboardPage.getFilterLabel('Service')).toHaveCount(0);
        const warning = dashboardPage.getFilterNoEffectIcon('Service');
        await expect(warning).toBeVisible();
        await warning.hover();
        await expect(
          dashboardPage.page.getByText(
            'This filter neither broadcasts nor acts as a variable - it has no effect',
          ),
        ).toBeVisible();
      });
    },
  );

  test('should save and restore query and filter values', {}, async () => {
    const testQuery = 'SeverityText:error';
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

    await test.step('Add ServiceName filter to dashboard', async () => {
      await dashboardPage.openEditFiltersModal();
      await expect(dashboardPage.emptyFiltersList).toBeVisible();

      await dashboardPage.addFilterToDashboard(
        'Service',
        DEFAULT_LOGS_SOURCE_NAME,
        'ServiceName',
      );

      await expect(dashboardPage.getFilterItemByName('Service')).toBeVisible();
      await dashboardPage.closeFiltersModal();
    });

    await test.step('Select a filter value', async () => {
      await dashboardPage.clickFilterOption('Service', 'accounting');

      // Verify the filter is applied
      const filterSelect = dashboardPage.getFilterSelectByName('Service');
      await expect(
        filterSelect.locator('..').getByText('accounting'),
      ).toBeVisible();
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

    await test.step('Return to dashboard and verify query and filters are restored', async () => {
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

      // Verify the saved filter value is populated
      const filterSelect = dashboardPage.getFilterSelectByName('Service');
      await expect(
        filterSelect.locator('..').getByText('accounting'),
      ).toBeVisible();
    });
  });

  test(
    'should handle URL query params overriding saved query',
    {},
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

        // Wait for the save success notification rather than a blind sleep, so
        // we only read the URL once the save has actually landed.
        const notification = dashboardPage.page.locator(
          'text=/Filter query and dropdown values/i',
        );
        await expect(notification).toBeVisible({ timeout: 5000 });

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
    'should enter and exit read-only live kiosk mode',
    { tag: ['@full-stack', '@dashboard'] },
    async () => {
      test.setTimeout(60000);
      const ts = Date.now();
      const kioskDashboardName = `Kiosk Dashboard ${ts}`;

      await test.step('Create and name a new dashboard', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.editDashboardName(kioskDashboardName);
      });

      await test.step('Add a basic chart tile', async () => {
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart('Kiosk Chart');
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      await test.step('Enter kiosk mode via the dashboard overflow menu', async () => {
        await dashboardPage.enterKioskMode();
      });

      await test.step('Assert URL contains kiosk=true', async () => {
        await expect(dashboardPage.page).toHaveURL(/kiosk=true/);
      });

      await test.step('Assert app nav, query controls, Add button, dashboard menu, tile action buttons, and resize handles are hidden', async () => {
        await expect(dashboardPage.appNav).toBeHidden();
        await expect(dashboardPage.searchInput).toBeHidden();
        await expect(dashboardPage.addButton).toBeHidden();
        await expect(dashboardPage.menuButton).toBeHidden();
        await expect(dashboardPage.firstTileActionsButton).toBeHidden();
        // Resize handles hidden/absent means the grid is locked (no drag/resize in
        // kiosk mode). react-grid-layout may retain a handle element in the DOM
        // when isResizable={false} but makes it invisible, so assert hidden rather
        // than absent (toBeHidden() passes for both CSS-hidden and missing elements).
        await expect(dashboardPage.tileResizeHandles).toBeHidden();
      });

      await test.step('Assert kiosk header with dashboard name and Live status are visible', async () => {
        await expect(dashboardPage.kioskHeader).toBeVisible();
        await expect(
          dashboardPage.getKioskHeading(kioskDashboardName),
        ).toBeVisible();
        await expect(dashboardPage.kioskLiveStatus).toBeVisible();
      });

      await test.step('Assert tile and chart remain visible', async () => {
        await expect(dashboardPage.getTiles().first()).toBeVisible();
        await expect(dashboardPage.getChartContainers().first()).toBeVisible();
      });

      await test.step('Reload in kiosk mode and assert URL mode, live status, and read-only chrome persist', async () => {
        await dashboardPage.reload();
        await expect(dashboardPage.page).toHaveURL(/kiosk=true/);
        await expect(dashboardPage.kioskLiveStatus).toBeVisible();
        await expect(dashboardPage.appNav).toBeHidden();
        await expect(dashboardPage.addButton).toBeHidden();
        await expect(dashboardPage.menuButton).toBeHidden();
      });

      await test.step('Exit kiosk mode via the Exit kiosk mode button', async () => {
        await dashboardPage.exitKioskMode();
      });

      await test.step('Assert kiosk param is removed from URL and dashboard chrome is restored', async () => {
        await expect(dashboardPage.page).not.toHaveURL(/kiosk=true/);
        await expect(dashboardPage.appNav).toBeVisible();
        await expect(dashboardPage.searchInput).toBeVisible();
        await expect(dashboardPage.addButton).toBeVisible();
        await expect(dashboardPage.menuButton).toBeVisible();
      });
    },
  );

  test.describe('Raw SQL Dashboard Tiles', () => {
    const LINE_SQL = `SELECT toStartOfInterval(Timestamp, INTERVAL {intervalSeconds:Int64} SECOND) AS ts, count() AS count FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) GROUP BY ts ORDER BY ts ASC`;

    const TABLE_SQL = `SELECT ServiceName, count() AS count FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) GROUP BY ServiceName LIMIT 200`;

    const NUMBER_SQL = `SELECT 1234 FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})`;

    const PIE_SQL = `SELECT ServiceName, count() FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) GROUP BY ServiceName`;

    test.beforeEach(async () => {
      await dashboardPage.createNewDashboard();
    });

    test('Line chart renders with Raw SQL query', async () => {
      test.setTimeout(60000);
      const ts = Date.now();
      const chartName = `E2E Raw SQL Line ${ts}`;

      await test.step('Open the tile editor', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
      });

      await test.step('Configure Raw SQL Line chart', async () => {
        await dashboardPage.chartEditor.setChartType(DisplayType.Line);
        await dashboardPage.chartEditor.setChartName(chartName);
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.typeSqlQuery(LINE_SQL);
      });

      await test.step('Run query and save', async () => {
        await dashboardPage.chartEditor.runQuery();
        await dashboardPage.saveTile();
      });

      await test.step('Verify the line chart renders on the dashboard', async () => {
        const tile = dashboardPage.getTiles().filter({ hasText: chartName });
        await expect(
          tile.locator('.recharts-responsive-container'),
        ).toBeVisible({ timeout: 15000 });
      });
    });

    test('Table chart renders with Raw SQL query', async () => {
      test.setTimeout(60000);
      const ts = Date.now();
      const chartName = `E2E Raw SQL Table ${ts}`;

      await test.step('Open the tile editor', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
      });

      await test.step('Configure Raw SQL Table chart', async () => {
        await dashboardPage.chartEditor.setChartType(DisplayType.Table);
        await dashboardPage.chartEditor.setChartName(chartName);
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.typeSqlQuery(TABLE_SQL);
      });

      await test.step('Run query and save', async () => {
        await dashboardPage.chartEditor.runQuery(false);
        await dashboardPage.saveTile();
      });

      await test.step('Verify the table chart renders on the dashboard', async () => {
        const tile = dashboardPage.getTiles().filter({ hasText: chartName });
        await expect(tile.locator('table')).toBeVisible({ timeout: 15000 });
      });
    });

    test('Number chart renders with Raw SQL query', async () => {
      test.setTimeout(60000);
      const ts = Date.now();
      const chartName = `E2E Raw SQL Number ${ts}`;

      await test.step('Open the tile editor', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
      });

      await test.step('Configure Raw SQL Number chart', async () => {
        await dashboardPage.chartEditor.setChartType(DisplayType.Number);
        await dashboardPage.chartEditor.setChartName(chartName);
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.typeSqlQuery(NUMBER_SQL);
      });

      await test.step('Run query and save', async () => {
        await dashboardPage.chartEditor.runQuery(false);
        await dashboardPage.saveTile();
      });

      await test.step('Verify the number chart renders on the dashboard', async () => {
        const tile = dashboardPage.getTiles().filter({ hasText: chartName });
        await expect(tile).toContainText('1234');
      });
    });

    test('Pie chart renders with Raw SQL query', async () => {
      test.setTimeout(60000);
      const ts = Date.now();
      const chartName = `E2E Raw SQL Pie ${ts}`;

      await test.step('Open the tile editor', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
      });

      await test.step('Configure Raw SQL Pie chart', async () => {
        await dashboardPage.chartEditor.setChartType(DisplayType.Pie);
        await dashboardPage.chartEditor.setChartName(chartName);
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.typeSqlQuery(PIE_SQL);
      });

      await test.step('Run query and save', async () => {
        await dashboardPage.chartEditor.runQuery();
        await dashboardPage.saveTile();
      });

      await test.step('Verify the pie chart renders on the dashboard', async () => {
        const tile = dashboardPage.getTiles().filter({ hasText: chartName });
        await expect(
          tile.locator('.recharts-responsive-container'),
        ).toBeVisible({ timeout: 15000 });
      });
    });

    test('Bar chart renders with Raw SQL query', async () => {
      test.setTimeout(60000);
      const ts = Date.now();
      const chartName = `E2E Raw SQL Bar ${ts}`;

      await test.step('Open the tile editor', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
      });

      await test.step('Configure Raw SQL Bar chart', async () => {
        await dashboardPage.chartEditor.setChartType(DisplayType.Bar);
        await dashboardPage.chartEditor.setChartName(chartName);
        await dashboardPage.chartEditor.switchToSqlMode();
        // Bar charts share the pie chart's categorical query shape.
        await dashboardPage.chartEditor.typeSqlQuery(PIE_SQL);
      });

      await test.step('Run query and save', async () => {
        await dashboardPage.chartEditor.runQuery();
        await dashboardPage.saveTile();
      });

      await test.step('Verify the bar chart renders on the dashboard', async () => {
        const tile = dashboardPage.getTiles().filter({ hasText: chartName });
        await expect(
          tile.locator(
            '[data-testid="bar-chart-container"] .recharts-responsive-container',
          ),
        ).toBeVisible({ timeout: 15000 });
      });
    });
  });

  test.describe('Dashboard Variables in Raw SQL Tiles', () => {
    // Both `$__filter(<expr>, <name>)` and a bare `$name` reference, so one
    // query exercises the macro and the plain-reference form together.
    const VARIABLE_SQL = `SELECT ServiceName, count() AS count FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) AND $__filter(ServiceName, svc) AND ServiceName IN ($svc) GROUP BY ServiceName LIMIT 200`;

    const VARIABLE_LINE_SQL = `SELECT toStartOfInterval(Timestamp, INTERVAL {intervalSeconds:Int64} SECOND) AS ts, count() AS count FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) AND $__filter(ServiceName, svc) GROUP BY ts ORDER BY ts ASC`;

    /** Add a variable-enabled `Service` filter exposed as `$svc`. */
    const addServiceVariable = async () => {
      await dashboardPage.openEditFiltersModal();
      await dashboardPage.addFilterToDashboard(
        'Service',
        DEFAULT_LOGS_SOURCE_NAME,
        'ServiceName',
        undefined,
        undefined,
        { variableName: 'svc' },
      );
      await expect(dashboardPage.getFilterItemByName('Service')).toBeVisible();
      await dashboardPage.closeFiltersModal();
    };

    test(
      'substitutes selected variable values in the tile editor previews',
      { tag: '@full-stack' },
      async () => {
        test.setTimeout(90000);
        const chartName = `E2E Variable Tile ${Date.now()}`;

        await test.step('Create a dashboard with a variable-enabled filter', async () => {
          await dashboardPage.createNewDashboard();
          await addServiceVariable();
        });

        await test.step('Select a value for the variable', async () => {
          await dashboardPage.clickFilterOption('Service', 'accounting');
          await dashboardPage.page.keyboard.press('Escape');
        });

        await test.step('Add a raw SQL tile that references the variable', async () => {
          await dashboardPage.addTile();
          await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
          await dashboardPage.chartEditor.waitForDataToLoad();
          await dashboardPage.chartEditor.setChartType(DisplayType.Table);
          await dashboardPage.chartEditor.setChartName(chartName);
          await dashboardPage.chartEditor.switchToSqlMode();
          await dashboardPage.chartEditor.typeSqlQuery(VARIABLE_SQL);
          await dashboardPage.chartEditor.runQuery(false);
        });

        await test.step('Generated SQL expands both reference forms', async () => {
          await dashboardPage.chartEditor.openGeneratedSql();
          await expect(async () => {
            const sql = await dashboardPage.chartEditor.getGeneratedSqlText();
            // $__filter(ServiceName, svc) -> (ServiceName IN ('accounting'))
            expect(sql).toContain("(ServiceName IN ('accounting'))");
            // ServiceName IN ($svc) -> ServiceName IN ('accounting')
            expect(sql).toMatch(
              /ServiceName IN \('accounting'\)[\s\S]*ServiceName IN \('accounting'\)/,
            );
            expect(sql).not.toContain('$svc');
          }).toPass({ timeout: 15000 });
        });

        await test.step('The preview table only shows the selected service', async () => {
          const preview = dashboardPage.page.getByRole('dialog').first();
          await expect(
            preview.getByTitle('accounting', { exact: true }),
          ).toBeVisible({ timeout: 15000 });
          await expect(preview.getByTitle('ad', { exact: true })).toHaveCount(
            0,
          );
        });

        await test.step('The saved tile applies the same substitution', async () => {
          await dashboardPage.saveTile();
          const tile = dashboardPage.getTiles().filter({ hasText: chartName });
          await expect(
            tile.getByTitle('accounting', { exact: true }),
          ).toBeVisible({ timeout: 15000 });
          await expect(tile.getByTitle('ad', { exact: true })).toHaveCount(0);
        });

        await test.step('Changing the selection re-renders the tile', async () => {
          await dashboardPage.toggleFilterValue('Service', 'accounting');
          await dashboardPage.toggleFilterValue('Service', 'ad');

          const tile = dashboardPage.getTiles().filter({ hasText: chartName });
          await expect(tile.getByTitle('ad', { exact: true })).toBeVisible({
            timeout: 15000,
          });
          await expect(
            tile.getByTitle('accounting', { exact: true }),
          ).toHaveCount(0);
        });
      },
    );

    test(
      'previews an alerting tile with every variable value emptied',
      { tag: '@full-stack' },
      async () => {
        test.setTimeout(90000);
        const chartName = `E2E Variable Alert Tile ${Date.now()}`;

        await test.step('Create a dashboard with a selected variable value', async () => {
          await dashboardPage.createNewDashboard();
          await addServiceVariable();
          await dashboardPage.clickFilterOption('Service', 'accounting');
          await dashboardPage.page.keyboard.press('Escape');
        });

        await test.step('Add a raw SQL line tile that references the variable', async () => {
          await dashboardPage.addTile();
          await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
          await dashboardPage.chartEditor.waitForDataToLoad();
          await dashboardPage.chartEditor.setChartType(DisplayType.Line);
          await dashboardPage.chartEditor.setChartName(chartName);
          await dashboardPage.chartEditor.switchToSqlMode();
          await dashboardPage.chartEditor.typeSqlQuery(VARIABLE_LINE_SQL);
          await dashboardPage.chartEditor.runQuery();
        });

        await test.step('Without an alert the preview uses the selected value', async () => {
          await dashboardPage.chartEditor.openGeneratedSql();
          await expect(async () => {
            const sql = await dashboardPage.chartEditor.getGeneratedSqlText();
            expect(sql).toContain("ServiceName IN ('accounting')");
          }).toPass({ timeout: 15000 });
        });

        await test.step('Adding an alert empties the variable in the preview', async () => {
          // An alert runs on a schedule with no dashboard filter selection, so
          // the preview must show what the alert will actually evaluate.
          await dashboardPage.chartEditor.clickAddAlert();
          await expect(async () => {
            const sql = await dashboardPage.chartEditor.getGeneratedSqlText();
            expect(sql).not.toContain('accounting');
            expect(sql).toMatch(/1\s*=\s*1/);
          }).toPass({ timeout: 15000 });
        });

        await test.step('Removing the alert restores the selected value', async () => {
          await dashboardPage.chartEditor.clickRemoveAlert();
          await expect(async () => {
            const sql = await dashboardPage.chartEditor.getGeneratedSqlText();
            expect(sql).toContain("ServiceName IN ('accounting')");
          }).toPass({ timeout: 15000 });
        });
      },
    );
  });

  test(
    'should deselect and hide the Custom aggregation function when switching to a metric source',
    { tag: '@full-stack' },
    async () => {
      await test.step('Navigate to dashboard and open new tile editor', async () => {
        await dashboardPage.openNewTileEditor();
      });

      await test.step('Select the "Custom" aggregation function', async () => {
        await dashboardPage.chartEditor.selectAggFn('Custom');
        const selectedAggFn =
          await dashboardPage.chartEditor.getSelectedAggFn();
        expect(selectedAggFn).toBe('Custom');
      });

      await test.step('Switch the source to a metric source', async () => {
        await dashboardPage.chartEditor.selectSource(
          DEFAULT_METRICS_SOURCE_NAME,
        );
      });

      await test.step('Verify the aggregation function was automatically changed away from "Custom"', async () => {
        const selectedAggFn =
          await dashboardPage.chartEditor.getSelectedAggFn();
        expect(selectedAggFn).toBe('Count of Events');
      });

      await test.step('Verify the "Custom" option is NOT available in the aggregation dropdown', async () => {
        const isCustomAvailable =
          await dashboardPage.chartEditor.isAggFnOptionAvailable('Custom');
        expect(isCustomAvailable).toBe(false);
      });
    },
  );

  test('should show error message and allow editing when tile source is missing', async ({
    page,
  }) => {
    const apiUrl = getApiUrl();
    const DELETABLE_SOURCE_NAME = `E2E Deletable Source ${Date.now()}`;

    // Get an existing log source to copy its connection
    const logSources = await getSources(page, 'log');
    const { connection, from } = logSources[0];

    // Create a dedicated source for this test via the API
    const createResponse = await page.request.post(`${apiUrl}/sources`, {
      data: {
        kind: 'log',
        name: DELETABLE_SOURCE_NAME,
        connection,
        from,
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression:
          'Timestamp, ServiceName, SeverityText, Body',
        serviceNameExpression: 'ServiceName',
        implicitColumnExpression: 'Body',
      },
    });
    expect(createResponse.ok()).toBeTruthy();
    const createdSource = await createResponse.json();

    await test.step('Create dashboard with tile using the deletable source', async () => {
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();

      await dashboardPage.addTile();
      await dashboardPage.chartEditor.waitForDataToLoad();
      await dashboardPage.chartEditor.setChartName('Missing Source Tile');
      await dashboardPage.chartEditor.selectSource(DELETABLE_SOURCE_NAME);
      await dashboardPage.chartEditor.runQuery();
      await dashboardPage.saveTile();

      await expect(dashboardPage.getTiles()).toHaveCount(1, {
        timeout: 10000,
      });
    });

    await test.step('Delete the source and reload the dashboard', async () => {
      const dashboardUrl = page.url();

      const deleteResponse = await page.request.delete(
        `${apiUrl}/sources/${createdSource.id}`,
      );
      expect(deleteResponse.ok()).toBeTruthy();

      await page.goto(dashboardUrl);
      await expect(dashboardPage.getTiles()).toHaveCount(1, {
        timeout: 10000,
      });
    });

    await test.step('Verify tile shows error message for missing source', async () => {
      const tile = dashboardPage.getTiles().first();
      await expect(tile).toContainText(
        'The data source for this tile no longer exists',
      );
    });

    await test.step('Verify tile can be edited when source is missing', async () => {
      // Edit now lives inside the tile actions (kebab) menu.
      await dashboardPage.openTileActionsMenu(0);

      const editButton = dashboardPage.getTileButton('edit');
      await expect(editButton).toBeVisible();
      await editButton.click();

      await expect(dashboardPage.chartEditor.nameInput).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test(
    'should clear saved query when WHERE input is cleared and saved',
    {},
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

  test.describe(
    'Table chart - Display Group By Columns on Left',
    { tag: ['@full-stack', '@dashboard'] },
    () => {
      test.beforeEach(async () => {
        await dashboardPage.createNewDashboard();
      });

      test('should move multiple group-by columns to the left when enabled', async () => {
        test.setTimeout(60000);
        const ts = Date.now();
        const chartName = `E2E GroupBy LHS Multi ${ts}`;
        let defaultHeaders: string[] = [];

        await test.step('Configure a Table chart with two group-by columns', async () => {
          await dashboardPage.addTile();
          await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
          await dashboardPage.chartEditor.waitForDataToLoad();
          await dashboardPage.chartEditor.setChartType(DisplayType.Table);
          await dashboardPage.chartEditor.selectSource(
            DEFAULT_LOGS_SOURCE_NAME,
          );
          await dashboardPage.chartEditor.setChartName(chartName);
          await dashboardPage.chartEditor.setGroupBy(
            'ServiceName, SeverityText',
          );
        });

        await test.step('Default order: series column first, group-by columns after', async () => {
          await dashboardPage.chartEditor.runQuery(false);
          defaultHeaders =
            await dashboardPage.chartEditor.getPreviewTableHeaders();

          const svcIdx = defaultHeaders.indexOf('ServiceName');
          const sevIdx = defaultHeaders.indexOf('SeverityText');
          expect(svcIdx).toBeGreaterThan(-1);
          expect(sevIdx).toBeGreaterThan(-1);
          const seriesIdx = defaultHeaders.findIndex(
            h => h !== 'ServiceName' && h !== 'SeverityText',
          );
          expect(seriesIdx).toBeGreaterThan(-1);
          expect(seriesIdx).toBeLessThan(svcIdx);
          expect(seriesIdx).toBeLessThan(sevIdx);
        });

        await test.step('Enable "Display Group By Columns on Left" and verify reorder', async () => {
          await dashboardPage.chartEditor.openDisplaySettings();
          await dashboardPage.chartEditor.setGroupByColumnsOnLeft(true);
          await dashboardPage.chartEditor.applyDisplaySettings();

          const headersAfter =
            await dashboardPage.chartEditor.getPreviewTableHeaders();
          expect(headersAfter.length).toBe(defaultHeaders.length);
          expect(headersAfter[0]).toBe('ServiceName');
          expect(headersAfter[1]).toBe('SeverityText');
          expect(['ServiceName', 'SeverityText']).not.toContain(
            headersAfter[headersAfter.length - 1],
          );
        });

        await test.step('Save the tile and verify it renders on the dashboard', async () => {
          await dashboardPage.saveTile();
          const tile = dashboardPage.getTiles().filter({ hasText: chartName });
          await expect(tile.locator('table')).toBeVisible({ timeout: 15000 });
        });
      });

      test('should move a single group-by column to the left when multiple series are present', async () => {
        test.setTimeout(60000);
        const ts = Date.now();
        const chartName = `E2E GroupBy LHS MultiSeries ${ts}`;
        let defaultHeaders: string[] = [];

        await test.step('Configure a Table chart with one group-by and two series', async () => {
          await dashboardPage.addTile();
          await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
          await dashboardPage.chartEditor.waitForDataToLoad();
          await dashboardPage.chartEditor.setChartType(DisplayType.Table);
          await dashboardPage.chartEditor.selectSource(
            DEFAULT_LOGS_SOURCE_NAME,
          );
          await dashboardPage.chartEditor.setChartName(chartName);
          await dashboardPage.chartEditor.setGroupBy('ServiceName');
          await dashboardPage.chartEditor.addSeries();
          // Distinct aliases so the two count() series render as two columns
          // instead of colliding into one.
          await dashboardPage.chartEditor.setSeriesAlias(0, 'SeriesOne');
          await dashboardPage.chartEditor.setSeriesAlias(1, 'SeriesTwo');
        });

        await test.step('Default order: series columns first, group-by column last', async () => {
          await dashboardPage.chartEditor.runQuery(false);
          defaultHeaders =
            await dashboardPage.chartEditor.getPreviewTableHeaders();
          expect(defaultHeaders).toEqual([
            'SeriesOne',
            'SeriesTwo',
            'ServiceName',
          ]);
        });

        await test.step('Enable "Display Group By Columns on Left" and verify reorder', async () => {
          await dashboardPage.chartEditor.openDisplaySettings();
          await dashboardPage.chartEditor.setGroupByColumnsOnLeft(true);
          await dashboardPage.chartEditor.applyDisplaySettings();

          const headersAfter =
            await dashboardPage.chartEditor.getPreviewTableHeaders();
          expect(headersAfter).toEqual([
            'ServiceName',
            'SeriesOne',
            'SeriesTwo',
          ]);
        });

        await test.step('Save the tile and verify it renders on the dashboard', async () => {
          await dashboardPage.saveTile();
          const tile = dashboardPage.getTiles().filter({ hasText: chartName });
          await expect(tile.locator('table')).toBeVisible({ timeout: 15000 });
        });
      });

      test('should move the group-by column to the left for ratio series return type', async () => {
        test.setTimeout(60000);
        const ts = Date.now();
        const chartName = `E2E GroupBy LHS Ratio ${ts}`;
        let defaultHeaders: string[] = [];

        await test.step('Configure a Table chart with ratio series and one group-by', async () => {
          await dashboardPage.addTile();
          await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
          await dashboardPage.chartEditor.waitForDataToLoad();
          await dashboardPage.chartEditor.setChartType(DisplayType.Table);
          await dashboardPage.chartEditor.selectSource(
            DEFAULT_LOGS_SOURCE_NAME,
          );
          await dashboardPage.chartEditor.setChartName(chartName);
          await dashboardPage.chartEditor.setGroupBy('ServiceName');
          await dashboardPage.chartEditor.addSeries();
          await dashboardPage.chartEditor.toggleAsRatio();
        });

        await test.step('Default order: single ratio column first, group-by column last', async () => {
          await dashboardPage.chartEditor.runQuery(false);
          defaultHeaders =
            await dashboardPage.chartEditor.getPreviewTableHeaders();
          expect(defaultHeaders.length).toBe(2);
          expect(defaultHeaders[defaultHeaders.length - 1]).toBe('ServiceName');
        });

        await test.step('Enable "Display Group By Columns on Left" and verify reorder', async () => {
          await dashboardPage.chartEditor.openDisplaySettings();
          await dashboardPage.chartEditor.setGroupByColumnsOnLeft(true);
          await dashboardPage.chartEditor.applyDisplaySettings();

          const headersAfter =
            await dashboardPage.chartEditor.getPreviewTableHeaders();
          expect(headersAfter.length).toBe(2);
          expect(headersAfter[0]).toBe('ServiceName');
        });

        await test.step('Save the tile and verify it renders on the dashboard', async () => {
          await dashboardPage.saveTile();
          const tile = dashboardPage.getTiles().filter({ hasText: chartName });
          await expect(tile.locator('table')).toBeVisible({ timeout: 15000 });
        });
      });
    },
  );

  test.describe(
    'Table chart - per-series number formats',
    { tag: ['@full-stack', '@dashboard'] },
    () => {
      test.beforeEach(async () => {
        await dashboardPage.createNewDashboard();
      });

      test('per-series format overrides chart-wide format and falls back when reset to inherit', async () => {
        test.setTimeout(15000);
        const ts = Date.now();
        const chartName = `E2E Per-Series Format ${ts}`;

        await test.step('Configure a Table chart with two series and a group-by', async () => {
          await dashboardPage.addTile();
          await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
          await dashboardPage.chartEditor.waitForDataToLoad();
          await dashboardPage.chartEditor.setChartType(DisplayType.Table);
          await dashboardPage.chartEditor.selectSource(
            DEFAULT_LOGS_SOURCE_NAME,
          );
          await dashboardPage.chartEditor.setChartName(chartName);
          await dashboardPage.chartEditor.setGroupBy('ServiceName');
          await dashboardPage.chartEditor.addSeries();
          await dashboardPage.chartEditor.setSeriesAlias(0, 'CountA');
          await dashboardPage.chartEditor.setSeriesAlias(1, 'CountB');
          await dashboardPage.chartEditor.runQuery(false);

          const headers =
            await dashboardPage.chartEditor.getPreviewTableHeaders();
          expect(headers).toContain('CountA');
          expect(headers).toContain('CountB');
          expect(headers).toContain('ServiceName');
        });

        let countAIndex = -1;
        let countBIndex = -1;

        await test.step('Set chart-wide format to Currency and assert both series render with $', async () => {
          await dashboardPage.chartEditor.setChartWideNumberFormat('Currency');

          const headers =
            await dashboardPage.chartEditor.getPreviewTableHeaders();
          countAIndex = headers.indexOf('CountA');
          countBIndex = headers.indexOf('CountB');
          expect(countAIndex).toBeGreaterThan(-1);
          expect(countBIndex).toBeGreaterThan(-1);

          const countACells =
            await dashboardPage.chartEditor.getPreviewTableCellTexts(
              countAIndex,
            );
          const countBCells =
            await dashboardPage.chartEditor.getPreviewTableCellTexts(
              countBIndex,
            );

          expect(countACells.length).toBeGreaterThan(0);
          expect(countBCells.length).toBeGreaterThan(0);
          for (const cell of countACells) {
            expect(cell).toContain('$');
          }
          for (const cell of countBCells) {
            expect(cell).toContain('$');
          }
        });

        await test.step('Override Series 0 (CountA) to Percentage; per-series wins, other series still inherits chart-wide', async () => {
          await dashboardPage.chartEditor.setSeriesNumberFormat(
            0,
            'Percentage',
          );

          const countACells =
            await dashboardPage.chartEditor.getPreviewTableCellTexts(
              countAIndex,
            );
          const countBCells =
            await dashboardPage.chartEditor.getPreviewTableCellTexts(
              countBIndex,
            );

          expect(countACells.length).toBeGreaterThan(0);
          for (const cell of countACells) {
            expect(cell).toContain('%');
          }

          expect(countBCells.length).toBeGreaterThan(0);
          for (const cell of countBCells) {
            expect(cell).toContain('$');
          }
        });

        // Asserts that all cells of the given tile column contain `substring`.
        // Polls because saveTile() returns before the dashboard tile finishes
        // re-rendering with the new chart config, and the table briefly shows
        // the previously-rendered values.
        const expectAllTileCellsToContain = async (
          tileIndex: number,
          columnIndex: number,
          substring: string,
        ) => {
          await expect
            .poll(
              async () => {
                const cells = await dashboardPage.getTileTableCellTexts(
                  tileIndex,
                  columnIndex,
                );
                return (
                  cells.length > 0 && cells.every(c => c.includes(substring))
                );
              },
              { timeout: 10000 },
            )
            .toBe(true);
        };

        await test.step('Save the tile and verify the saved tile retains per-series formatting', async () => {
          await dashboardPage.saveTile();
          await expect(dashboardPage.chartEditor.nameInput).toBeHidden({
            timeout: 5000,
          });

          const tile = dashboardPage.getTiles().filter({ hasText: chartName });
          await expect(tile.locator('table')).toBeVisible({ timeout: 15000 });

          const tileHeaders = await dashboardPage.getTileTableHeaders(0);
          const tileCountAIndex = tileHeaders.indexOf('CountA');
          const tileCountBIndex = tileHeaders.indexOf('CountB');
          expect(tileCountAIndex).toBeGreaterThan(-1);
          expect(tileCountBIndex).toBeGreaterThan(-1);

          await expectAllTileCellsToContain(0, tileCountAIndex, '%');
          await expectAllTileCellsToContain(0, tileCountBIndex, '$');
        });

        await test.step('Reset Series 0 (CountA) to Inherit; column falls back to chart-wide Currency', async () => {
          await dashboardPage.editTile(0);
          await expect(dashboardPage.chartEditor.nameInput).toBeVisible();

          await dashboardPage.chartEditor.clearSeriesNumberFormat(0);
          await dashboardPage.chartEditor.runQuery(false);

          const headers =
            await dashboardPage.chartEditor.getPreviewTableHeaders();
          const updatedCountAIndex = headers.indexOf('CountA');
          expect(updatedCountAIndex).toBeGreaterThan(-1);

          const countACells =
            await dashboardPage.chartEditor.getPreviewTableCellTexts(
              updatedCountAIndex,
            );
          expect(countACells.length).toBeGreaterThan(0);
          for (const cell of countACells) {
            expect(cell).toContain('$');
          }

          await dashboardPage.saveTile();
          await expect(dashboardPage.chartEditor.nameInput).toBeHidden({
            timeout: 5000,
          });

          const tileHeaders = await dashboardPage.getTileTableHeaders(0);
          const tileCountAIndex = tileHeaders.indexOf('CountA');
          await expectAllTileCellsToContain(0, tileCountAIndex, '$');
        });
      });
    },
  );

  test(
    'should isolate the fullscreen tile time picker from the dashboard time range',
    { tag: ['@full-stack', '@dashboard'] },
    async () => {
      test.setTimeout(60000);
      const ts = Date.now();
      const chartName = `Fullscreen TP Test ${ts}`;

      await test.step('Create a new dashboard', async () => {
        await expect(dashboardPage.createButton).toBeVisible();
        await dashboardPage.createNewDashboard();
      });

      await test.step('Add a basic chart tile', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.createBasicChart(chartName);

        const dashboardTiles = dashboardPage.getTiles();
        await expect(dashboardTiles).toHaveCount(1, { timeout: 10000 });
      });

      let mainTimePickerValueBefore = '';
      await test.step('Set the dashboard time range to "Last 1 hour"', async () => {
        await dashboardPage.timePicker.selectRelativeTime('Last 1 hour');
        mainTimePickerValueBefore =
          await dashboardPage.timePicker.input.inputValue();
        console.log(
          'Main time picker value before opening fullscreen:',
          mainTimePickerValueBefore,
        );
      });

      await test.step('Open the tile in fullscreen and verify the modal appears', async () => {
        await dashboardPage.openFullscreenForTile(0);
        await expect(dashboardPage.fullscreenTimePickerInput).toBeVisible();
      });

      await test.step('Verify the fullscreen TimePicker is initialized with a non-empty value', async () => {
        // The fullscreen picker is seeded with dateRangeToString — an absolute
        // date-range string — not the "Last 1 hour" relative label.
        const fullscreenValue =
          await dashboardPage.fullscreenTimePickerInput.inputValue();
        expect(fullscreenValue.length).toBeGreaterThan(0);
      });

      await test.step('Change the fullscreen time range to "Last 15 minutes"', async () => {
        await dashboardPage.selectFullscreenRelativeTime('Last 15 minutes');
        // Verify the chart inside the modal re-renders with the new range
        await expect(
          dashboardPage.fullscreenModalBody.locator(
            '.recharts-responsive-container',
          ),
        ).toBeVisible({ timeout: 15000 });
      });

      await test.step('Close the fullscreen modal', async () => {
        await dashboardPage.closeFullscreen();
      });

      await test.step('Verify the dashboard main time picker is unchanged', async () => {
        // The fullscreen time-range change must NOT have propagated to the
        // dashboard-level time picker.
        await expect(dashboardPage.timePicker.input).toHaveValue(
          mainTimePickerValueBefore,
        );
      });
    },
  );

  test(
    'should navigate to the dashboard listing page after deleting a dashboard',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const uniqueName = `E2E Delete Nav Dashboard ${ts}`;

      await test.step('Create a new saved dashboard', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(uniqueName);
      });

      await test.step('Open the delete dashboard dialog via the dashboard menu', async () => {
        await dashboardPage.openDeleteDashboardDialog();
        await expect(dashboardPage.deleteConfirmModal).toBeVisible();
      });

      await test.step('Cancel the deletion and verify the dashboard is still open', async () => {
        await dashboardPage.cancelDeleteDashboardDialog();
        await expect(dashboardPage.deleteConfirmModal).toBeHidden();
        await expect(dashboardPage.dashboardPageContainer).toBeVisible();
      });

      await test.step('Reopen the delete dialog and confirm deletion', async () => {
        await dashboardPage.openDeleteDashboardDialog();
        await expect(dashboardPage.deleteConfirmModal).toBeVisible();
        await dashboardPage.confirmDeleteDashboard();
      });

      await test.step('Verify navigation to the dashboards listing page', async () => {
        await expect(page).toHaveURL(/\/dashboards\/list/);
        await expect(dashboardsListPage.pageContainer).toBeVisible();
      });

      await test.step('Verify the deleted dashboard is not listed', async () => {
        await expect(
          dashboardsListPage.getDashboardCard(uniqueName),
        ).toBeHidden();
      });
    },
  );

  // The Terraform export gate on this page has two halves: the feature/local-mode
  // flag (covered once in ResourceTerraformPopover's unit test, since every call
  // site routes through that component) and the per-resource eligibility
  // predicate, which is only wired up here.
  //
  // Deliberately one test, not a visible case plus a hidden case. A lone
  // `toBeHidden()` passes for any reason the button is missing — wrong page
  // state, slow render, a renamed testid — so it would keep passing with
  // `isImportableDashboard` deleted. Asserting visible on this same dashboard
  // FIRST, then provisioning it and asserting hidden, makes the transition
  // itself the assertion: it can only pass if the predicate does the work.
  test(
    'should withhold Terraform import once a dashboard becomes provisioned',
    { tag: '@full-stack' },
    async ({ page }) => {
      const uniqueName = `E2E Provisioned Dashboard ${Date.now()}`;
      const terraformButton = page.locator(
        '[data-testid^="terraform-popover-button-"]',
      );
      let dashboardId: string;

      await test.step('Create a saved dashboard', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(uniqueName);
        dashboardId = dashboardPage.getCurrentDashboardId();
      });

      await test.step('Verify the export affordance is offered', async () => {
        await expect(terraformButton).toBeVisible();
      });

      await test.step('Mark it provisioned', async () => {
        // ProvisionDashboardsTask is the only thing that sets this in normal
        // operation, so write it directly rather than running that job.
        const out = runMongoshScript(
          [
            "use('hyperdx-e2e');",
            'print(JSON.stringify(db.dashboards.updateOne(',
            `  { _id: ObjectId(${JSON.stringify(dashboardId)}) },`,
            '  { $set: { provisioned: true } }',
            ')));',
          ].join('\n'),
        );
        // A zero-match write would make the assertion below pass for a reason
        // that has nothing to do with the gate.
        expect(out).toContain('"matchedCount":1');
        expect(out).toContain('"modifiedCount":1');
      });

      await test.step('Verify it is withheld after reload', async () => {
        await dashboardPage.gotoDashboard(dashboardId);
        // Wait for THIS dashboard's data to land before asserting absence —
        // otherwise the assertion races an unrendered page and passes for the
        // wrong reason.
        await expect(dashboardPage.dashboardName).toHaveText(uniqueName);
        // Terraform and ProvisionDashboardsTask would both claim ownership of
        // this dashboard, so the popover must not appear.
        await expect(terraformButton).toBeHidden();
      });
    },
  );

  // The other half of the dashboard export gate. Same self-proving shape as the
  // provisioned case: assert visible on this dashboard first, then make it
  // ineligible and assert hidden, so the transition itself is the assertion.
  test(
    'should withhold Terraform import once a dashboard gains a PromQL tile',
    { tag: '@full-stack' },
    async ({ page }) => {
      const uniqueName = `E2E PromQL Dashboard ${Date.now()}`;
      const terraformButton = page.locator(
        '[data-testid^="terraform-popover-button-"]',
      );
      let dashboardId: string;

      await test.step('Create a saved dashboard', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(uniqueName);
        dashboardId = dashboardPage.getCurrentDashboardId();
      });

      await test.step('Verify the export affordance is offered', async () => {
        await expect(terraformButton).toBeVisible();
      });

      await test.step('Give it a PromQL tile', async () => {
        // Written directly rather than built in the chart editor: the editor
        // flow for a PromQL tile is long and this test is about the gate, not
        // the editor.
        const out = runMongoshScript(
          [
            "use('hyperdx-e2e');",
            'print(JSON.stringify(db.dashboards.updateOne(',
            `  { _id: ObjectId(${JSON.stringify(dashboardId)}) },`,
            "  { $set: { tiles: [{ id: 'promql-1', x: 0, y: 0, w: 4, h: 2,",
            "      config: { configType: 'promql', promqlExpression: 'up',",
            "                connection: 'c1', displayType: 'line' } }] } }",
            ')));',
          ].join('\n'),
        );
        expect(out).toContain('"matchedCount":1');
        expect(out).toContain('"modifiedCount":1');
      });

      await test.step('Verify it is withheld after reload', async () => {
        await dashboardPage.gotoDashboard(dashboardId);
        await expect(dashboardPage.dashboardName).toHaveText(uniqueName);
        // Importing this dashboard would delete the PromQL tile on the next
        // apply, because the provider reads it back through external API v2.
        await expect(terraformButton).toBeHidden();
      });
    },
  );
});
