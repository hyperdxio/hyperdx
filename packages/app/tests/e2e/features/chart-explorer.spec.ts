import { ChartExplorerPage } from '../page-objects/ChartExplorerPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
} from '../utils/constants';

test.describe('Chart Explorer Functionality', { tag: ['@charts'] }, () => {
  let chartExplorerPage: ChartExplorerPage;

  test.beforeEach(async ({ page }) => {
    chartExplorerPage = new ChartExplorerPage(page);
    await chartExplorerPage.goto();
    await chartExplorerPage.chartEditor.waitForDataToLoad();
  });

  test('should run a query and see chart types available', async () => {
    await test.step('Run default query with line chart', async () => {
      await chartExplorerPage.chartEditor.runQuery();
      const chartContainer = chartExplorerPage.getFirstChart();
      await expect(chartContainer).toBeVisible();
    });

    await test.step('Verify all chart type tabs are available', async () => {
      await expect(chartExplorerPage.getChartTypeTab('line')).toBeVisible();
      await expect(chartExplorerPage.getChartTypeTab('table')).toBeVisible();
      await expect(chartExplorerPage.getChartTypeTab('number')).toBeVisible();
    });
  });

  test('should create a chart with group by and verify grouped series', async () => {
    await test.step('Select logs source and set group by', async () => {
      await chartExplorerPage.chartEditor.selectSource(
        DEFAULT_LOGS_SOURCE_NAME,
      );
      await chartExplorerPage.chartEditor.setGroupBy('ServiceName');
    });

    await test.step('Run query and verify chart renders', async () => {
      await chartExplorerPage.chartEditor.runQuery();
      const chartContainer = chartExplorerPage.getFirstChart();
      await expect(chartContainer).toBeVisible();
    });
  });

  test('should select a metric source and run query', async () => {
    await test.step('Select metrics source and metric', async () => {
      await chartExplorerPage.chartEditor.selectSource(
        DEFAULT_METRICS_SOURCE_NAME,
      );
      await chartExplorerPage.chartEditor.selectMetric(
        'k8s.pod.cpu.utilization',
        'k8s.pod.cpu.utilization:::::::gauge',
      );
    });

    await test.step('Run query and verify chart renders', async () => {
      await chartExplorerPage.chartEditor.runQuery();
      const chartContainer = chartExplorerPage.getFirstChart();
      await expect(chartContainer).toBeVisible();
    });
  });

  test('should switch to SQL mode and run a raw SQL query', async () => {
    await test.step('Switch to SQL mode', async () => {
      await chartExplorerPage.chartEditor.switchToSqlMode();
    });

    await test.step('Type and run SQL query', async () => {
      const sql = [
        'SELECT toStartOfInterval(TimestampTime, INTERVAL 60 SECOND) AS ts,',
        ' count() AS count',
        ' FROM default.e2e_otel_logs',
        ' WHERE TimestampTime >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64})',
        ' AND TimestampTime < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})',
        ' GROUP BY ts ORDER BY ts ASC',
      ].join('');
      await chartExplorerPage.chartEditor.typeSqlQuery(sql);
      await chartExplorerPage.chartEditor.runQuery();
    });

    await test.step('Verify chart renders', async () => {
      const chartContainer = chartExplorerPage.getFirstChart();
      await expect(chartContainer).toBeVisible();
    });
  });
});
