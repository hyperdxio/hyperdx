import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { SERVICES } from '../seed-clickhouse';
import { getApiUrl, getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../utils/constants';

test.describe('Heatmap modes', { tag: ['@full-stack', '@dashboard'] }, () => {
  test('switching a new tile to heatmap fills in the trace duration', async ({
    page,
  }) => {
    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;

    await dashboardPage.goto();
    await dashboardPage.createNewDashboard();
    await dashboardPage.addTile();
    await expect(editor.nameInput).toBeVisible();
    await editor.waitForDataToLoad();
    await editor.setChartType(DisplayType.Heatmap);

    await expect(editor.source).toHaveValue(DEFAULT_TRACES_SOURCE_NAME);
    // The placeholder also mentions Duration, so match the full expression.
    await expect(editor.heatmapValueInput).toHaveText('(Duration)/1e6');
  });

  test('series heatmap mode drops the hidden distribution where', async ({
    page,
  }) => {
    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;
    const whereMarker = 'e2e-heatmap-mode-toggle';

    await dashboardPage.goto();
    await dashboardPage.createNewDashboard();
    await dashboardPage.addTile();
    await expect(editor.nameInput).toBeVisible();
    await editor.waitForDataToLoad();
    await editor.setChartType(DisplayType.Heatmap);
    await expect(editor.source).toHaveValue(DEFAULT_TRACES_SOURCE_NAME);

    await editor.setSqlWhere(`SpanName != '${whereMarker}'`);
    await editor.runQuery(false);
    await editor.openGeneratedSql();
    await expect
      .poll(() => editor.getAllGeneratedSqlText())
      .toContain(whereMarker);

    await editor.setHeatmapMode('Series');
    await expect(editor.source).toHaveValue(DEFAULT_TRACES_SOURCE_NAME);
    await editor.openGeneratedSql();
    await expect
      .poll(() => editor.getAllGeneratedSqlText())
      .not.toContain(whereMarker);

    await editor.setHeatmapMode('Distribution');
    await editor.openGeneratedSql();
    await expect
      .poll(() => editor.getAllGeneratedSqlText())
      .toContain(whereMarker);
  });

  test('series heatmap with a group by renders and persists', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;
    const ts = Date.now();
    const tileName = `E2E Series Heatmap ${ts}`;

    const assertTileRenders = async () => {
      const heatmap = dashboardPage.getTileHeatmap();
      await expect(heatmap.canvas.first()).toBeVisible({ timeout: 20000 });
      await expect(dashboardPage.getTileError()).toHaveCount(0);
      await expect(heatmap.notEnoughDataText).toHaveCount(0);
      await heatmap.hoverPopulatedCell();
      expect(SERVICES).toContain(await heatmap.hoveredSeriesName());

      const axisTooltip = await heatmap.hoverSeriesAxisLabel();
      await expect(axisTooltip).toHaveText(
        new RegExp(`^(${SERVICES.join('|')})$`),
      );
    };

    await test.step('Create a series heatmap on the log source', async () => {
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.editDashboardName(`E2E Series Heatmap ${ts}`);
      await dashboardPage.addTile();
      await expect(editor.nameInput).toBeVisible();
      await editor.waitForDataToLoad();
      await editor.setChartType(DisplayType.Heatmap);
      // Distribution heatmaps are trace-only, so pick the mode first.
      await editor.setHeatmapMode('Series');
      await editor.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      await expect(editor.source).toHaveValue(DEFAULT_LOGS_SOURCE_NAME);
      // Heatmaps use the chart-level number format only.
      await expect(
        page.getByRole('button', { name: 'Edit display format' }),
      ).toHaveCount(0);
      await editor.setGroupBy('ServiceName');
      await editor.setChartName(tileName);
      await editor.runQuery(false);
      await editor.save();
    });

    await test.step('Tile renders, and still renders after reload', async () => {
      await assertTileRenders();
      await dashboardPage.reload();
      await assertTileRenders();
    });

    await test.step('The editor reopens in series mode', async () => {
      await dashboardPage.editTile(0);
      await expect(editor.nameInput).toBeVisible();
      await expect(editor.heatmapModeOption('Series')).toBeChecked();
    });
  });

  test('distribution heatmap saves unchanged and keeps its event deltas link', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;
    const ts = Date.now();

    let dashboardId = '';
    await test.step('Seed a distribution heatmap tile saved before heatmap modes existed', async () => {
      const traceSource = (await getSources(page, 'trace')).find(
        s => s.name === DEFAULT_TRACES_SOURCE_NAME,
      );
      expect(traceSource).toBeDefined();
      const response = await page.request.post(`${getApiUrl()}/dashboards`, {
        data: {
          name: `E2E Distribution Heatmap ${ts}`,
          tags: [],
          tiles: [
            {
              id: `distribution-heatmap-${ts}`,
              x: 0,
              y: 0,
              w: 12,
              h: 10,
              config: {
                name: 'Distribution heatmap',
                displayType: DisplayType.Heatmap,
                source: traceSource._id,
                select: [
                  {
                    aggFn: 'count',
                    aggCondition: '',
                    aggConditionLanguage: 'lucene',
                    valueExpression: '(Duration)/1e6',
                    countExpression: 'count()',
                    heatmapScaleType: 'log',
                  },
                ],
                where: '',
                whereLanguage: 'lucene',
                numberFormat: { output: 'duration', factor: 0.001 },
              },
            },
          ],
        },
      });
      expect(response.ok()).toBe(true);
      const body = await response.json();
      dashboardId = body.id;
    });

    const assertTileRenders = async () => {
      const heatmap = dashboardPage.getTileHeatmap();
      await expect(heatmap.canvas.first()).toBeVisible({ timeout: 20000 });
      await expect(dashboardPage.getTileError()).toHaveCount(0);
      await expect(heatmap.notEnoughDataText).toHaveCount(0);
      await heatmap.hoverPopulatedCell();
    };

    await test.step('Tile renders', async () => {
      await dashboardPage.gotoDashboard(dashboardId);
      await assertTileRenders();
    });

    await test.step('Edit and save the tile unchanged', async () => {
      await dashboardPage.editTile(0);
      await expect(editor.nameInput).toBeVisible();
      await editor.waitForDataToLoad();
      // Known bug: the tile-menu click that opens the editor also bubbles to
      // the tile and opens its event deltas popover, whose overlay covers the
      // editor. Clicking the overlay dismisses it without reaching the editor.
      // Drop these lines once the tile ignores clicks from its menu.
      await expect(
        page.getByTestId('heatmap-view-event-deltas-link'),
      ).toBeVisible();
      await page.mouse.click(5, 5);
      await editor.save();
      await dashboardPage.reload();
      await assertTileRenders();
    });

    await test.step('Switch the y axis scale in display settings', async () => {
      await dashboardPage.editTile(0);
      await expect(editor.nameInput).toBeVisible();
      await editor.waitForDataToLoad();
      // The same known popover bug as above.
      await expect(
        page.getByTestId('heatmap-view-event-deltas-link'),
      ).toBeVisible();
      await page.mouse.click(5, 5);
      await editor.setHeatmapScale('Linear');
      await editor.save();
      await dashboardPage.reload();
      await assertTileRenders();

      await dashboardPage.editTile(0);
      await expect(editor.nameInput).toBeVisible();
      await editor.waitForDataToLoad();
      await expect(
        page.getByTestId('heatmap-view-event-deltas-link'),
      ).toBeVisible();
      await page.mouse.click(5, 5);
      await editor.openDisplaySettings();
      await expect(editor.heatmapScaleOption('Linear')).toBeChecked();
      await editor.applyDisplaySettings();
      await editor.save();
    });

    await test.step('Clicking the tile links to event deltas', async () => {
      await dashboardPage.getTileHeatmap().container.click();
      const link = page.getByTestId('heatmap-view-event-deltas-link');
      await expect(link).toBeVisible();
      await link.click();
      await expect(page).toHaveURL(/\/search\?.*mode=delta/);
    });
  });
});
