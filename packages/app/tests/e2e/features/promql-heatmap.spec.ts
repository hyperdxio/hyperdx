/**
 * PromQL heatmaps draw either a distribution of every series' samples,
 * bucketed client-side, or one row per series of a range query, named by the
 * legend template.
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

/** Open a new tile on a new dashboard as a PromQL heatmap of `EXPRESSION`. */
async function startPromqlHeatmapTile(dashboardPage: DashboardPage) {
  const editor = dashboardPage.chartEditor;
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
}

/** Save the tile, and check it renders before and after a reload. */
async function saveAndAssertRenders(
  dashboardPage: DashboardPage,
  assertRenders: (heatmap: HeatmapComponent) => Promise<void>,
) {
  await dashboardPage.chartEditor.save();
  await expect(dashboardPage.getTiles()).toHaveCount(1, { timeout: 10000 });
  await expect(dashboardPage.getTileError()).toHaveCount(0);
  await assertRenders(dashboardPage.getTileHeatmap());
  await dashboardPage.reload();
  await assertRenders(dashboardPage.getTileHeatmap());
}

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
      await startPromqlHeatmapTile(dashboardPage);
      await editor.setHeatmapMode('Series');
      await editor.setLegendTemplate('{{service}}');
      await editor.runQuery(false);
    });

    await test.step('The editor offers no instant query', async () => {
      await expect(page.getByTestId('promql-query-type-control-0')).toHaveCount(
        0,
      );
      await expect(editor.granularityPicker).toBeVisible();
    });

    await test.step('The preview draws a row per series', async () => {
      await assertRendersServices(editor.previewHeatmap);
      await editor.openGeneratedPromql();
      await expect
        .poll(() => editor.getGeneratedPromqlText())
        .toMatch(/^last_over_time\(.+\[\d+s\]\)$/);
    });

    await test.step('The saved tile renders, and still renders after reload', async () => {
      await saveAndAssertRenders(dashboardPage, assertRendersServices);
    });
  });

  test('draws a distribution of the samples, and persists', async ({
    page,
  }) => {
    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;

    // Every service reports 1, so a populated cell counts at most one sample
    // per service, in a row around 1.
    const assertRendersDistribution = async (heatmap: HeatmapComponent) => {
      await expect(heatmap.canvas.first()).toBeVisible();
      await expect(heatmap.notEnoughDataText).toHaveCount(0);
      await heatmap.hoverPopulatedCell();
      const count = Number(await heatmap.hoveredTooltipValue('Count Value'));
      expect(count).toBeGreaterThan(0);
      expect(count).toBeLessThanOrEqual(SERVICES.length);
      expect(await heatmap.hoveredTooltipValue('Y Value')).toMatch(
        /^1(\.\d+)?\b/,
      );
    };

    await test.step('Create a PromQL heatmap tile', async () => {
      await startPromqlHeatmapTile(dashboardPage);
      await editor.runQuery(false);
    });

    await test.step('Distribution is the default mode, on a linear scale', async () => {
      await expect(editor.heatmapModeOption('Distribution')).toBeChecked();
      await editor.openDisplaySettings();
      await expect(editor.heatmapScaleOption('Linear')).toBeChecked();
      await editor.applyDisplaySettings();
    });

    await test.step('The preview draws the distribution', async () => {
      await assertRendersDistribution(editor.previewHeatmap);
    });

    await test.step('The saved tile renders, and still renders after reload', async () => {
      await saveAndAssertRenders(dashboardPage, assertRendersDistribution);
    });

    await test.step('The chosen scale persists', async () => {
      await dashboardPage.editTile(0);
      await expect(editor.nameInput).toBeVisible();
      await editor.waitForDataToLoad();
      await editor.setHeatmapScale('Log');
      await editor.save();
      await dashboardPage.reload();
      await dashboardPage.editTile(0);
      await expect(editor.nameInput).toBeVisible();
      await editor.openDisplaySettings();
      await expect(editor.heatmapScaleOption('Log')).toBeChecked();
    });
  });
});
