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
});
