import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { ChartExplorerPage } from '../page-objects/ChartExplorerPage';
import { expect, test } from '../utils/base-test';

test.describe('Chart Explorer Functionality', { tag: ['@charts'] }, () => {
  let chartExplorerPage: ChartExplorerPage;

  test.beforeEach(async ({ page }) => {
    chartExplorerPage = new ChartExplorerPage(page);
    await chartExplorerPage.goto();
  });

  test('should interact with chart configuration', async () => {
    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
    });

    await test.step('Can run basic query and display chart', async () => {
      // Use chart editor component to run query
      await expect(chartExplorerPage.chartEditor.runButton).toBeVisible();
      // wait for network idle
      await chartExplorerPage.page.waitForLoadState('networkidle');

      await chartExplorerPage.chartEditor.runQuery();

      // Verify chart is rendered
      const chartContainer = chartExplorerPage.getFirstChart();
      await expect(chartContainer).toBeVisible();
    });
  });

  test('should render a bar chart', async () => {
    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
    });

    await test.step('Select the Bar chart type', async () => {
      await chartExplorerPage.page.waitForLoadState('networkidle');
      await chartExplorerPage.chartEditor.setChartType(DisplayType.Bar);
    });

    await test.step('Run query and verify the bar chart renders', async () => {
      await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
      await chartExplorerPage.chartEditor.runQuery();

      await expect(
        chartExplorerPage.page.locator(
          '[data-testid="bar-chart-container"] .recharts-responsive-container',
        ),
      ).toBeVisible({ timeout: 15000 });
    });
  });

  test('should limit the number of bars on a categorical bar chart', async () => {
    let totalBars = 0;

    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
      await chartExplorerPage.page.waitForLoadState('networkidle');
    });

    await test.step('Select the Bar chart type', async () => {
      await chartExplorerPage.chartEditor.setChartType(DisplayType.Bar);
    });

    await test.step('Set group by ServiceName and run the query', async () => {
      await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
      await chartExplorerPage.chartEditor.runQuery();

      await expect(chartExplorerPage.getBars().first()).toBeVisible({
        timeout: 15000,
      });
    });

    await test.step('Verify the unrestricted chart renders more bars than the limit we will apply', async () => {
      totalBars = await chartExplorerPage.getBars().count();
      expect(totalBars).toBeGreaterThan(3);
    });

    await test.step('Apply a series limit of 3', async () => {
      await chartExplorerPage.chartEditor.setSeriesLimit(3);
      // Re-run to ensure the limited config is fetched and rendered even if
      // the Display Settings drawer's own auto-submit hasn't settled yet.
      await chartExplorerPage.chartEditor.runQuery();
    });

    await test.step('Verify the chart now renders exactly the limited number of bars', async () => {
      const seriesLimit = 3;
      await expect
        .poll(async () => chartExplorerPage.getBars().count(), {
          timeout: 10000,
        })
        .toBe(seriesLimit);

      // Sanity check: the limit actually reduced the number of bars shown.
      expect(seriesLimit).toBeLessThan(totalBars);
    });
  });

  test('should apply a custom ORDER BY on a categorical bar chart', async () => {
    let ascendingLabels: string[] = [];
    let descendingLabels: string[] = [];

    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
      await chartExplorerPage.page.waitForLoadState('networkidle');
    });

    await test.step('Select the Bar chart type and group by ServiceName', async () => {
      await chartExplorerPage.chartEditor.setChartType(DisplayType.Bar);
      await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
    });

    await test.step('Order by ServiceName ascending and capture the bar order', async () => {
      await chartExplorerPage.chartEditor.setOrderBy('ServiceName ASC');
      await chartExplorerPage.chartEditor.runQuery();
      await expect(chartExplorerPage.getBars().first()).toBeVisible({
        timeout: 15000,
      });

      ascendingLabels = await chartExplorerPage.getBarLabels();
      // Need at least two distinct bars for the ordering to be observable.
      expect(ascendingLabels.length).toBeGreaterThan(1);
    });

    await test.step('Order by ServiceName descending and verify the order is reversed', async () => {
      await chartExplorerPage.chartEditor.setOrderBy('ServiceName DESC');
      await chartExplorerPage.chartEditor.runQuery();

      // The descending result must be the exact reverse of the ascending one,
      // proving the custom ORDER BY is driving the SQL query ordering.
      await expect
        .poll(async () => chartExplorerPage.getBarLabels(), { timeout: 10000 })
        .toEqual([...ascendingLabels].reverse());

      descendingLabels = await chartExplorerPage.getBarLabels();
    });

    await test.step('Apply a series limit and confirm the custom order still drives which bars are kept', async () => {
      const seriesLimit = 3;
      await chartExplorerPage.chartEditor.setSeriesLimit(seriesLimit);
      await chartExplorerPage.chartEditor.runQuery();

      await expect
        .poll(async () => chartExplorerPage.getBars().count(), {
          timeout: 10000,
        })
        .toBe(seriesLimit);

      // With ServiceName DESC + LIMIT 3, the kept bars must be the first three
      // of the descending order — not the three largest by value. This proves
      // the custom ORDER BY overrides the default value-descending ordering and
      // is honored alongside the series limit.
      await expect
        .poll(async () => chartExplorerPage.getBarLabels(), { timeout: 10000 })
        .toEqual(descendingLabels.slice(0, seriesLimit));
    });
  });

  test('should apply a custom ORDER BY on a categorical pie chart', async () => {
    let ascendingLabels: string[] = [];
    let descendingLabels: string[] = [];

    await test.step('Verify chart configuration form is accessible', async () => {
      await expect(chartExplorerPage.form).toBeVisible();
      await chartExplorerPage.page.waitForLoadState('networkidle');
    });

    await test.step('Select the Pie chart type and group by ServiceName', async () => {
      await chartExplorerPage.chartEditor.setChartType(DisplayType.Pie);
      await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
    });

    await test.step('Order by ServiceName ascending and capture the legend order', async () => {
      await chartExplorerPage.chartEditor.setOrderBy('ServiceName ASC');
      await chartExplorerPage.chartEditor.runQuery();

      ascendingLabels = await chartExplorerPage.getPieLegendLabels();
      // Need at least two distinct slices for the ordering to be observable.
      expect(ascendingLabels.length).toBeGreaterThan(1);
    });

    await test.step('Order by ServiceName descending and verify the order is reversed', async () => {
      await chartExplorerPage.chartEditor.setOrderBy('ServiceName DESC');
      await chartExplorerPage.chartEditor.runQuery();

      // The descending result must be the exact reverse of the ascending one,
      // proving the custom ORDER BY is driving the SQL query ordering.
      await expect
        .poll(async () => chartExplorerPage.getPieLegendLabels(), {
          timeout: 10000,
        })
        .toEqual([...ascendingLabels].reverse());

      descendingLabels = await chartExplorerPage.getPieLegendLabels();
    });

    await test.step('Apply a series limit and confirm the custom order still drives which slices are kept', async () => {
      const seriesLimit = 3;
      await chartExplorerPage.chartEditor.setSeriesLimit(seriesLimit);
      await chartExplorerPage.chartEditor.runQuery();

      // With ServiceName DESC + LIMIT 3, the kept slices must be the first
      // three of the descending order — not the three largest by value. This
      // proves the custom ORDER BY overrides the default value-descending
      // ordering and is honored alongside the series limit.
      await expect
        .poll(async () => chartExplorerPage.getPieLegendLabels(), {
          timeout: 10000,
        })
        .toEqual(descendingLabels.slice(0, seriesLimit));
    });
  });
});
