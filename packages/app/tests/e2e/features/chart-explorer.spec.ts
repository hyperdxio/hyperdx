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
});
