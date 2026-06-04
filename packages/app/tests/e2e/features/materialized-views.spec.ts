/**
 * Materialized View Acceleration — E2E tests.
 *
 * Fixture sources (defined in e2e-fixtures.json):
 *   - 'E2E Traces MV'              — trace source WITH a pre-configured 1-minute
 *                                    aggregating MV (e2e_otel_traces_1m).
 *   - 'E2E Traces MV AutoPopulate' — identical trace source WITHOUT an MV, used
 *                                    to test configuring one via the source form.
 *
 * A plain count() time chart over the MV source is accelerated (count is a
 * pre-aggregated column and needs no group-by), so the tests deliberately avoid
 * configuring a group-by to keep the chart-builder interactions reliable.
 *
 * All tests require the full-stack backend (MongoDB + API + ClickHouse).
 */
import { MaterializedViewComponent } from '../components/MaterializedViewComponent';
import { SourceFormComponent } from '../components/SourceFormComponent';
import { DashboardPage } from '../page-objects/DashboardPage';
import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_TRACES_MV_AUTOPOPULATE_SOURCE_NAME,
  DEFAULT_TRACES_MV_SOURCE_NAME,
  E2E_TRACES_MV_TABLE,
} from '../utils/constants';

test.describe(
  'Materialized View Acceleration',
  { tag: ['@full-stack', '@dashboard'] },
  () => {
    test('MV indicator shows Accelerated in chart editor', async ({ page }) => {
      const dashboardPage = new DashboardPage(page);
      const mvComponent = new MaterializedViewComponent(page);

      // Create a new dashboard and set a 1-hour time window so seeded data is found.
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.timePicker.selectRelativeTime('Last 1 hour');

      // Open the new-tile editor and configure a count() chart over the
      // MV-backed trace source (count is a pre-aggregated MV column).
      await dashboardPage.addTile();
      await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      await dashboardPage.chartEditor.waitForDataToLoad();
      await dashboardPage.chartEditor.selectSource(
        DEFAULT_TRACES_MV_SOURCE_NAME,
      );
      // Leave the default Count of Events aggregation untouched (re-selecting it
      // via the dropdown can clear it); count() over the MV is accelerated.
      await dashboardPage.chartEditor.setChartName('MV Count Chart');
      await dashboardPage.chartEditor.runQuery();

      // The MV indicator (badge variant) should appear and confirm acceleration.
      await mvComponent.expectAccelerated();
    });

    test('MV indicator and chart data show on saved dashboard tile', async ({
      page,
    }) => {
      const dashboardPage = new DashboardPage(page);
      const mvComponent = new MaterializedViewComponent(page);
      const dashboardName = `MV Tile Test ${Date.now()}`;

      // Create a named dashboard so it persists through navigation.
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.editDashboardName(dashboardName);
      await dashboardPage.timePicker.selectRelativeTime('Last 1 hour');

      // Add a tile with an MV-accelerated count() chart configuration.
      await dashboardPage.addTile();
      await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      await dashboardPage.chartEditor.waitForDataToLoad();
      await dashboardPage.chartEditor.selectSource(
        DEFAULT_TRACES_MV_SOURCE_NAME,
      );
      // Leave the default Count of Events aggregation untouched (re-selecting it
      // via the dropdown can clear it); count() over the MV is accelerated.
      await dashboardPage.chartEditor.setChartName('MV Count Chart');
      await dashboardPage.chartEditor.runQuery();

      // Save the tile to close the editor and return to the dashboard view.
      await dashboardPage.chartEditor.save();

      // The tile auto-queries on render; the chart populating from MV data
      // confirms requirement "charts are populated based on data from MVs".
      const tile = dashboardPage.getTile(0);
      await expect(tile.locator('.recharts-responsive-container')).toBeVisible({
        timeout: 15000,
      });

      // The icon-variant MV indicator inside the tile should show acceleration.
      await mvComponent.expectAccelerated(tile);
    });

    test('MV modal shows correct configuration for the active materialized view', async ({
      page,
    }) => {
      const dashboardPage = new DashboardPage(page);
      const mvComponent = new MaterializedViewComponent(page);

      // Create a new dashboard and configure an MV-accelerated count() chart.
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.timePicker.selectRelativeTime('Last 1 hour');
      await dashboardPage.addTile();
      await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      await dashboardPage.chartEditor.waitForDataToLoad();
      await dashboardPage.chartEditor.selectSource(
        DEFAULT_TRACES_MV_SOURCE_NAME,
      );
      // Leave the default Count of Events aggregation untouched (re-selecting it
      // via the dropdown can clear it); count() over the MV is accelerated.
      await dashboardPage.chartEditor.setChartName('MV Count Chart');
      await dashboardPage.chartEditor.runQuery();

      await mvComponent.expectAccelerated();

      // Open the modal and verify the E2E fixture MV table is listed and active.
      await mvComponent.openModal();
      await expect(mvComponent.getModal()).toBeVisible();
      await expect(mvComponent.getModalItem(E2E_TRACES_MV_TABLE)).toBeVisible();

      // Expand the accordion item to reveal the config summary.
      await mvComponent.expandModalItem(E2E_TRACES_MV_TABLE);
      await mvComponent.expectStatus(E2E_TRACES_MV_TABLE, 'active');

      // Granularity pill should show the MV's 1-minute bucket size.
      await expect(mvComponent.getGranularityPill('1 minute')).toBeVisible();

      // Both dimension columns declared in the MV should be listed.
      await expect(mvComponent.getDimensionPill('ServiceName')).toBeVisible();
      await expect(mvComponent.getDimensionPill('StatusCode')).toBeVisible();

      // The aggregated columns table should list Duration with avg/max/quantile
      // aggregations and a count row.
      const aggTable = mvComponent.getAggregatedColumnsTable();
      await expect(aggTable).toBeVisible();
      await expect(aggTable).toContainText('Column');
      await expect(aggTable).toContainText('Aggregation');
      await expect(aggTable).toContainText('Duration');
      await expect(aggTable).toContainText('avg');
      await expect(aggTable).toContainText('max');
      await expect(aggTable).toContainText('quantile');
      await expect(aggTable).toContainText('count');
    });

    test(
      'Configuring an MV with auto-population in the source form',
      { tag: '@sources' },
      async ({ page }) => {
        test.setTimeout(60000);

        const searchPage = new SearchPage(page);
        const sourceForm = new SourceFormComponent(page);

        // Navigate to the search page and select the auto-populate fixture source
        // (this source has no MV configured, making it safe to test configuration
        // without mutating the pre-configured 'E2E Traces MV' source).
        await searchPage.goto();
        await searchPage.selectSource(
          DEFAULT_TRACES_MV_AUTOPOPULATE_SOURCE_NAME,
        );

        // Open the source edit modal.
        await searchPage.openEditSourceModal();

        // Add a new MV configuration block.
        await sourceForm.addMaterializedView();

        // Select the pre-existing ClickHouse MV table (e2e_otel_traces_1m).
        // This triggers inference of the MV schema.
        await sourceForm.selectMvTable(0, E2E_TRACES_MV_TABLE);

        // Wait for the inference success notification.
        await sourceForm.waitForInferenceSuccess();

        // Granularity should be inferred as "1 minute" (matching the MV bucket size).
        await expect(sourceForm.getGranularityInput(0)).toHaveValue('1 minute');

        // Dimension columns should list ServiceName and StatusCode.
        await expect(sourceForm.getDimensionColumnsEditor(0)).toContainText(
          'ServiceName',
        );
        await expect(sourceForm.getDimensionColumnsEditor(0)).toContainText(
          'StatusCode',
        );

        // Timestamp column should be inferred as "Timestamp".
        await expect(sourceForm.getTimestampColumnEditor(0)).toContainText(
          'Timestamp',
        );

        // All four aggregated columns (count + avg/max/quantile of Duration)
        // should have been inferred and rendered as rows.
        await expect(sourceForm.getAggregatedColumnFnSelects(0)).toHaveCount(
          4,
          {
            timeout: 10000,
          },
        );

        // Close the modal without saving to avoid mutating the shared fixture source.
        await page.keyboard.press('Escape');
      },
    );
  },
);
