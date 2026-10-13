/**
 * PromQL heatmaps are series heatmaps: one row per series of a range query,
 * named by the legend template. There is no distribution mode to pick.
 *
 * The seed gives `e2e_service_up` one series per `SERVICES` entry, labelled
 * `service`, one sample of 1 a minute.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { HeatmapComponent } from '../components/HeatmapComponent';
import { DashboardPage } from '../page-objects/DashboardPage';
import { SERVICES } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import { E2E_PROMQL_METRIC_NAME, PROMQL_SOURCE_NAME } from '../utils/constants';

// Ends in `)` rather than inside the selector so the autocomplete popup closes.
const EXPRESSION = `last_over_time(${E2E_PROMQL_METRIC_NAME}{service!=""}[$__interval])`;

test.describe('PromQL heatmaps', { tag: ['@dashboard', '@full-stack'] }, () => {
  test('draws a row per series, and persists', async ({ page }) => {
    test.setTimeout(120000);

    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;
    const servicePattern = new RegExp(`^(${SERVICES.join('|')})$`);

    const assertRendersServices = async (heatmap: HeatmapComponent) => {
      await expect(heatmap.canvas.first()).toBeVisible({ timeout: 30000 });
      await expect(heatmap.notEnoughDataText).toHaveCount(0);
      await heatmap.hoverPopulatedCell();
      expect(SERVICES).toContain(await heatmap.hoveredSeriesName());
      await expect(await heatmap.hoverSeriesAxisLabel()).toHaveText(
        servicePattern,
      );
    };

    await test.step('Create a PromQL heatmap tile', async () => {
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.addTile();
      await expect(editor.nameInput).toBeVisible();
      await editor.waitForDataToLoad();
      await editor.setChartType(DisplayType.Heatmap);
      await editor.switchToPromqlMode();
      await editor.selectSource(PROMQL_SOURCE_NAME);
      await editor.setChartName('PromQL heatmap tile');
      await editor.replacePromqlExpression(EXPRESSION);
      await editor.setLegendTemplate('{{service}}');
      await editor.runQuery(false);
    });

    await test.step('The editor offers no heatmap mode or instant query', async () => {
      await expect(page.getByTestId('heatmap-mode-control')).toHaveCount(0);
      await expect(page.getByTestId('promql-query-type-control-0')).toHaveCount(
        0,
      );
      await expect(editor.granularityPicker).toBeVisible();
    });

    await test.step('The preview draws a row per series', async () => {
      await assertRendersServices(
        new HeatmapComponent(page, page.getByTestId('tile-editor-form')),
      );
      await editor.openGeneratedPromql();
      await expect
        .poll(() => editor.getGeneratedPromqlText())
        .toMatch(/^last_over_time\(.+\[\d+s\]\)$/);
    });

    await test.step('The saved tile renders, and still renders after reload', async () => {
      await editor.save();
      await expect(dashboardPage.getTiles()).toHaveCount(1, {
        timeout: 10000,
      });
      await expect(dashboardPage.getTileError()).toHaveCount(0);
      await assertRendersServices(dashboardPage.getTileHeatmap());
      await dashboardPage.reload();
      await assertRendersServices(dashboardPage.getTileHeatmap());
    });
  });
});
