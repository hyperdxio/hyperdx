/**
 * `$__interval`, `$__range` and `$__rate_interval` expand to concrete
 * durations before a PromQL expression reaches Prometheus, in the chart
 * explorer and on dashboards with no variables. An unexpanded macro is a
 * PromQL parse error, so a rendered chart or value proves expansion.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { ChartExplorerPage } from '../page-objects/ChartExplorerPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { E2E_PROMQL_METRIC_NAME, PROMQL_SOURCE_NAME } from '../utils/constants';

const ONE_SERIES = `${E2E_PROMQL_METRIC_NAME}{service="accounting"}`;

test.describe('PromQL macros', { tag: ['@charts', '@full-stack'] }, () => {
  test('expands macros in the chart explorer', async ({ page }) => {
    test.setTimeout(120000);

    const chartExplorerPage = new ChartExplorerPage(page);
    const editor = chartExplorerPage.chartEditor;

    await test.step('Query a PromQL chart that uses a macro', async () => {
      await chartExplorerPage.goto();
      await expect(chartExplorerPage.form).toBeVisible();
      await editor.switchToPromqlMode();
      await editor.selectSource(PROMQL_SOURCE_NAME);
      await editor.setChartType(DisplayType.Number);
      await editor.replacePromqlExpression(
        `last_over_time(${ONE_SERIES}[$__rate_interval])`,
      );
      await editor.runQuery(false);

      // The seed writes 1 for every sample of this series.
      await expect(page.getByTestId('number-chart-value')).toHaveText('1', {
        timeout: 30000,
      });
    });

    await test.step('The preview shows the expanded duration', async () => {
      await editor.openGeneratedPromql();
      const preview = page.getByTestId('chart-promql-preview');
      await expect(preview).toContainText(/last_over_time\(.+\[\d+s\]\)/);
      await expect(preview).not.toContainText('$__');
    });
  });

  test('expands macros on a dashboard without variables', async ({ page }) => {
    test.setTimeout(120000);

    const dashboardPage = new DashboardPage(page);
    const editor = dashboardPage.chartEditor;
    const value = page.getByTestId('number-chart-value');

    await test.step('Create a PromQL number tile that uses $__range', async () => {
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.addTile();
      await expect(editor.nameInput).toBeVisible();
      await editor.waitForDataToLoad();
      await editor.switchToPromqlMode();
      await editor.selectSource(PROMQL_SOURCE_NAME);
      await editor.setChartName('PromQL macro tile');
      await editor.setChartType(DisplayType.Number);
      await editor.replacePromqlExpression(
        `last_over_time(${ONE_SERIES}[$__range])`,
      );
      await editor.runQuery(false);

      // The seed writes 1 for every sample of this series.
      await expect(value).toHaveText('1', { timeout: 30000 });
    });

    await test.step('The saved tile still queries successfully', async () => {
      await editor.save();
      await expect(dashboardPage.getTiles()).toHaveCount(1, {
        timeout: 10000,
      });
      await expect(page.getByTestId('number-chart-value')).toHaveText('1', {
        timeout: 30000,
      });
    });
  });
});
