import { ClickHouseDashboardPage } from '../page-objects/ClickHouseDashboardPage';
import { expect, test } from '../utils/base-test';

test.describe('ClickHouse Dashboard', { tag: ['@full-stack'] }, () => {
  let clickhousePage: ClickHouseDashboardPage;

  test.beforeEach(async ({ page }) => {
    clickhousePage = new ClickHouseDashboardPage(page);
  });

  test('should load heatmap chart without error', async () => {
    await clickhousePage.goto();
    await clickhousePage.waitForPageLoad();

    // Select the local connection
    await clickhousePage.selectConnection('local');

    // Assert the heatmap rendered without error
    await expect(await clickhousePage.queryLatencyChart).toBeVisible();
  });
});
