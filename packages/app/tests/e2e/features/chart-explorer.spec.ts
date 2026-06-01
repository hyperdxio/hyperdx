import { ChartExplorerPage } from '../page-objects/ChartExplorerPage';
import { expect, test } from '../utils/base-test';

function getDateRangeFromProxyUrl(url: string): [number, number] {
  const timestamps = Array.from(new URL(url).searchParams.values())
    .filter(value => /^\d{13}$/.test(value))
    .map(Number)
    .sort((a, b) => a - b);

  expect(timestamps).toHaveLength(2);
  return [timestamps[0], timestamps[1]];
}

test.describe('Chart Explorer Functionality', { tag: ['@charts'] }, () => {
  let chartExplorerPage: ChartExplorerPage;

  test.beforeEach(async ({ page }) => {
    chartExplorerPage = new ChartExplorerPage(page);
    await chartExplorerPage.goto();
  });

  test(
    'should split Run chart queries into adjacent ClickHouse chunks',
    { tag: ['@full-stack'] },
    async () => {
      await test.step('Wait for initial chart explorer activity to settle', async () => {
        await chartExplorerPage.waitForInitialSettle();
      });

      await chartExplorerPage.chartEditor.setChartName(
        `E2E Chunked Chart ${Date.now()}`,
      );

      // Begin recording only after the initial settle so any auto-run queries
      // fired on page load are excluded from the assertion.
      const proxyRecorder =
        chartExplorerPage.startRecordingClickhouseProxyRequests();

      await test.step('Click Run and wait for chart to render', async () => {
        await chartExplorerPage.chartEditor.runQuery();
      });

      await test.step('Assert Run used adjacent ClickHouse chunks, not duplicates', async () => {
        const requests = proxyRecorder.getRequests();

        expect(requests).toHaveLength(2);
        expect(new Set(requests.map(request => request.postData)).size).toBe(2);

        const ranges = requests
          .map(request => getDateRangeFromProxyUrl(request.url))
          .sort((a, b) => a[0] - b[0]);

        expect(ranges[0][1]).toBe(ranges[1][0]);
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
