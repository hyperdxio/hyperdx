import { ChartExplorerPage } from '../page-objects/ChartExplorerPage';
import { expect, test } from '../utils/base-test';

test.describe('Chart Explorer Functionality', { tag: ['@charts'] }, () => {
  let chartExplorerPage: ChartExplorerPage;

  test.beforeEach(async ({ page }) => {
    chartExplorerPage = new ChartExplorerPage(page);
    await chartExplorerPage.goto();
  });

  test(
    'should fire exactly one clickhouse-proxy request when Run is clicked',
    { tag: ['@full-stack'] },
    async () => {
      await test.step('Wait for initial chart explorer activity to settle', async () => {
        await chartExplorerPage.waitForInitialSettle();
      });

      // Begin counting proxy responses only after the initial settle so
      // any auto-run queries fired on page load are excluded from the tally.
      const proxyCounter =
        chartExplorerPage.startCountingClickhouseProxyResponses();

      await test.step('Click Run and wait for chart to render', async () => {
        await chartExplorerPage.chartEditor.runQuery();
      });

      await test.step('Assert exactly one clickhouse-proxy request was fired', async () => {
        // Regression: prior to the fix, clicking Run fired duplicate requests.
        expect(proxyCounter.getCount()).toBe(1);
      });
    },
  );

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
