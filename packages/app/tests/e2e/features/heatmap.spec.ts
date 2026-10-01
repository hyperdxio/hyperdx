import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';

test.describe('Heatmap', () => {
  test(
    'event deltas heatmap renders, drag-selects, and switches scale',
    { tag: ['@full-stack', '@search'] },
    async ({ page }) => {
      test.setTimeout(90000);
      const searchPage = new SearchPage(page);

      await test.step('Open event deltas on the trace source', async () => {
        await searchPage.goto();
        await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
        await searchPage.timePicker.selectRelativeTime('Last 1 hour');
        await searchPage.table.waitForRowsToPopulate();
        await searchPage.switchToEventDeltas();
      });

      await test.step('Heatmap renders', async () => {
        await expect(searchPage.heatmap.canvas.first()).toBeVisible({
          timeout: 20000,
        });
        await expect(searchPage.heatmap.notEnoughDataText).toHaveCount(0);
        await expect(searchPage.chartErrorState).toHaveCount(0);
        await searchPage.heatmap.hoverPopulatedCell();
        await expect(searchPage.deltaNoSelectionHint).toBeVisible({
          timeout: 20000,
        });
      });

      await test.step('Drag-select enters comparison mode', async () => {
        await searchPage.heatmap.dragSelect();
        await expect(page).toHaveURL(/[?&]xMin=/);
        await expect(page).toHaveURL(/[?&]xMax=/);
        await expect(page).toHaveURL(/[?&]yMin=/);
        await expect(page).toHaveURL(/[?&]yMax=/);
        await expect(searchPage.deltaSelectionLegend).toBeVisible();
        await expect(searchPage.deltaBackgroundLegend).toBeVisible();
        await expect(searchPage.deltaNoSelectionHint).toHaveCount(0);
      });

      await test.step('Switch scale to linear', async () => {
        await searchPage.openHeatmapSettings();
        await searchPage.setHeatmapScale('Linear');
        await searchPage.applyHeatmapSettings();
        await expect(page).toHaveURL(/[?&]scaleType=linear/);
        await expect(searchPage.heatmap.canvas.first()).toBeVisible({
          timeout: 20000,
        });
        await expect(searchPage.heatmap.notEnoughDataText).toHaveCount(0);
        await expect(searchPage.chartErrorState).toHaveCount(0);
        await searchPage.heatmap.hoverPopulatedCell();
      });
    },
  );

  test(
    'dashboard heatmap tile renders and persists across reload',
    { tag: ['@full-stack', '@dashboard'] },
    async ({ page }) => {
      test.setTimeout(90000);
      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;
      const ts = Date.now();
      const dashboardName = `E2E Heatmap Dashboard ${ts}`;
      const tileName = `E2E Heatmap Tile ${ts}`;

      await test.step('Create a dashboard', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await dashboardPage.editDashboardName(dashboardName);
      });

      await test.step('Add a heatmap tile on the trace source', async () => {
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await editor.setChartType(DisplayType.Heatmap);
        await editor.selectSource(DEFAULT_TRACES_SOURCE_NAME);
        await expect(editor.source).toHaveValue(DEFAULT_TRACES_SOURCE_NAME);
        await editor.setChartName(tileName);
        await editor.runQuery(false);
        await editor.save();
      });

      const assertTileRendersHeatmap = async () => {
        const heatmap = dashboardPage.getTileHeatmap();
        await expect(heatmap.canvas.first()).toBeVisible({ timeout: 20000 });
        await expect(dashboardPage.getTileError()).toHaveCount(0);
        await expect(heatmap.notEnoughDataText).toHaveCount(0);
        await heatmap.hoverPopulatedCell();
      };

      await test.step('Tile renders the heatmap', assertTileRendersHeatmap);

      await test.step('Tile still renders after reload', async () => {
        await dashboardPage.reload();
        await assertTileRendersHeatmap();
      });
    },
  );
});
