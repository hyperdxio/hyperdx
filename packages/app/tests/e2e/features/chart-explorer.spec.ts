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
});
