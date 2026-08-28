import { ChartExplorerPage } from '../page-objects/ChartExplorerPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_METRICS_SOURCE_NAME,
  E2E_CLICKHOUSE_DATABASE,
  E2E_METRICS_GAUGE_TABLE,
} from '../utils/constants';

const CLICKHOUSE_HOST =
  process.env.CLICKHOUSE_HOST ||
  `http://localhost:${process.env.HDX_E2E_CH_PORT || '20500'}`;

async function clickhouseSelect(sql: string): Promise<string[]> {
  const url = new URL(CLICKHOUSE_HOST);
  url.searchParams.set('user', process.env.CLICKHOUSE_USER || 'default');
  if (process.env.CLICKHOUSE_PASSWORD) {
    url.searchParams.set('password', process.env.CLICKHOUSE_PASSWORD);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    body: `${sql} FORMAT TSV`,
    headers: { 'Content-Type': 'text/plain' },
  });
  if (!response.ok) {
    throw new Error(
      `ClickHouse query failed (${response.status}): ${await response.text()}`,
    );
  }
  return (await response.text()).trim().split('\n').filter(Boolean);
}

/**
 * The browse list is legitimately a subset — the index only records
 * `MetricName` at granule boundaries. What must hold is that typing finds the
 * rest, since a metric the index omits is the one a user goes looking for.
 */
test.describe('Metric name streaming', { tag: ['@charts'] }, () => {
  let chartExplorerPage: ChartExplorerPage;

  test.beforeEach(async ({ page }) => {
    chartExplorerPage = new ChartExplorerPage(page);
    await chartExplorerPage.goto();
  });

  test('browses from the index and finds the rest by searching', async ({
    page,
  }) => {
    const namesInTable = await clickhouseSelect(
      `SELECT DISTINCT MetricName FROM ${E2E_CLICKHOUSE_DATABASE}.${E2E_METRICS_GAUGE_TABLE} ORDER BY MetricName`,
    );
    const namesInIndex = await clickhouseSelect(
      `SELECT DISTINCT MetricName FROM mergeTreeIndex('${E2E_CLICKHOUSE_DATABASE}', '${E2E_METRICS_GAUGE_TABLE}') ORDER BY MetricName`,
    );
    // Without one of these the test would pass without exercising search.
    const missingFromIndex = namesInTable.filter(
      name => !namesInIndex.includes(name),
    );
    console.log(
      `gauge names — data: ${namesInTable.length}, index: ${namesInIndex.length}, index-invisible: ${missingFromIndex.join(', ') || 'none'}`,
    );
    expect(
      missingFromIndex.length,
      'seeded table no longer has an index-invisible metric to search for',
    ).toBeGreaterThan(0);

    const metricSelect = page.getByTestId('metric-name-selector');
    // The `:::::::` value distinguishes these from the source picker's options,
    // which render in the same portal.
    const metricOptions = page.locator(
      '[data-combobox-option="true"][value*=":::::::"]',
    );
    const offeredGaugeNames = async () =>
      (
        await metricOptions.evaluateAll(nodes =>
          nodes.map(node => node.getAttribute('value') ?? ''),
        )
      )
        .filter(value => value.endsWith(':::::::gauge'))
        .map(value => value.replace(':::::::gauge', ''));

    await test.step('Select the metrics source', async () => {
      await chartExplorerPage.chartEditor.waitForDataToLoad();
      await chartExplorerPage.chartEditor.selectSource(
        DEFAULT_METRICS_SOURCE_NAME,
      );
    });

    await test.step('Browsing fills from the index and says so', async () => {
      await expect(metricSelect).toBeVisible();
      await metricSelect.click();
      await expect(metricOptions.first()).toBeVisible({ timeout: 15000 });

      const browsed = await offeredGaugeNames();
      expect(browsed.length).toBeGreaterThan(0);
      expect(namesInTable).toEqual(expect.arrayContaining(browsed));
      // Incomplete here, so the control must invite typing.
      await expect(metricSelect).toHaveAttribute(
        'placeholder',
        'Search metrics...',
      );
    });

    await test.step('Typing finds a metric the index cannot see', async () => {
      const target = missingFromIndex[0];
      await metricSelect.fill(target);

      // Authoritative, and ranked first since it is an exact match.
      await expect
        .poll(offeredGaugeNames, { timeout: 15000 })
        .toContain(target);
      expect((await offeredGaugeNames())[0]).toBe(target);
    });
  });
});
