/**
 * PromQL series limit: a per-tile cap on how many series a time chart renders.
 * It is applied in the browser (keeping the top N by peak value), so the
 * warning icon offers "load all" to bypass it.
 *
 * The seed gives `e2e_service_up` one series per `SERVICES` entry (10), all
 * with the same value, so which series survive the cap is arbitrary. The
 * assertions count series rather than name them.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { SERVICES } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import { E2E_PROMQL_METRIC_NAME, PROMQL_SOURCE_NAME } from '../utils/constants';

const ALL_SERIES = `${E2E_PROMQL_METRIC_NAME}{service!=""}`;
const SERIES_COUNT = SERVICES.length;
// The legend lists this many series before collapsing the rest into "+N more".
const LEGEND_ITEM_LIMIT = 4;
const SERIES_LIMIT = 2;

test.describe(
  'PromQL series limit',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    test('caps rendered series, offers load-all, and round-trips', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;
      const legend = page.locator('.recharts-legend-wrapper').first();
      // The legend middle-truncates long labels (`e2e_service_up{s..ce="x"}`),
      // so match on the metric name that always survives.
      const legendSeries = legend.getByText(E2E_PROMQL_METRIC_NAME);
      const loadAll = page.getByRole('button', {
        name: `Load all ${SERIES_COUNT} series`,
      });

      await test.step('Create a dashboard with a PromQL line tile', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await editor.switchToPromqlMode();
        await editor.selectSource(PROMQL_SOURCE_NAME);
        await editor.setChartName('PromQL series limit tile');
        await editor.replacePromqlExpression(ALL_SERIES);
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      await test.step('Without a limit every series is rendered', async () => {
        await expect(
          legend.getByText(`+${SERIES_COUNT - LEGEND_ITEM_LIMIT} more`),
        ).toBeVisible({ timeout: 30000 });
        await expect(loadAll).toHaveCount(0);
      });

      await test.step('A series limit caps the legend and warns', async () => {
        await dashboardPage.editTile(0);
        await expect(editor.nameInput).toBeVisible();
        await editor.setSeriesLimit(SERIES_LIMIT);
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(legendSeries).toHaveCount(SERIES_LIMIT, {
          timeout: 30000,
        });
        await expect(legend.getByText(/\+\d+ more/)).toHaveCount(0);
        await expect(loadAll).toBeVisible();
      });

      await test.step('Load all bypasses the limit', async () => {
        await loadAll.click();
        await expect(
          legend.getByText(`+${SERIES_COUNT - LEGEND_ITEM_LIMIT} more`),
        ).toBeVisible({ timeout: 30000 });
        await expect(loadAll).toHaveCount(0);
      });

      await test.step('The saved limit applies again after a reload', async () => {
        await dashboardPage.reload();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(legendSeries).toHaveCount(SERIES_LIMIT, {
          timeout: 30000,
        });
        await expect(loadAll).toBeVisible();
      });

      await test.step('The limit round-trips into the editor', async () => {
        await dashboardPage.editTile(0);
        await expect(editor.nameInput).toBeVisible();
        await editor.openDisplaySettings();
        const drawer = page.getByRole('dialog', { name: 'Display Settings' });
        await expect(drawer.getByLabel('Series Limit')).toHaveValue(
          String(SERIES_LIMIT),
        );
      });
    });
  },
);
