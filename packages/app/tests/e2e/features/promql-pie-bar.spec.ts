/**
 * PromQL pie and bar tiles draw one slice or bar per series: a range query is
 * reduced to one value per series, and an instant query already is one. The
 * series come from the expression, not from a group-by, so there is no ORDER BY
 * or series limit to set.
 *
 * The seed gives `e2e_service_up` one series per `SERVICES` entry, labelled
 * `service`, one sample of 1 a minute.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { SERVICES } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import { E2E_PROMQL_METRIC_NAME, PROMQL_SOURCE_NAME } from '../utils/constants';

/**
 * Every seeded series. The trailing brace closes the editor's autocomplete
 * popup, which would otherwise cover the query type control.
 */
const ALL_SERIES = `${E2E_PROMQL_METRIC_NAME}{service!=""}`;

test.describe(
  'PromQL pie and bar tiles',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    test('draws one slice per series for range and instant queries', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;
      const legend = page.getByTestId('pie-chart-legend');
      const drawer = page.getByRole('dialog', { name: 'Display Settings' });
      // Scoped to the editor: the dashboard header carries its own picker.
      const editorGranularity = page
        .getByTestId('tile-editor-form')
        .getByTestId('granularity-picker');

      await test.step('Create a PromQL pie tile', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await editor.switchToPromqlMode();
        await editor.selectSource(PROMQL_SOURCE_NAME);
        await editor.setChartName('PromQL pie tile');
        await editor.setChartType(DisplayType.Pie);
        await editor.replacePromqlExpression(ALL_SERIES);
        await editor.runQuery(false);
      });

      await test.step('A range query draws one slice per series', async () => {
        await expect(legend).toBeVisible({ timeout: 30000 });
        await expect(legend.getByTitle(/service="/)).toHaveCount(
          SERVICES.length,
        );
        await expect(editorGranularity).toBeVisible();
        await expect(page.getByTestId('order-by-input')).toBeHidden();
      });

      await test.step('Display settings offer a legend template and number format, not a series limit', async () => {
        await editor.setLegendTemplate('{{service}}');
        await editor.openDisplaySettings();
        await expect(drawer.getByLabel('Series Limit')).toBeHidden();
        await editor.setNumberFormatOutput('Currency');
        await editor.applyDisplaySettings();
        await editor.runQuery(false);

        for (const service of SERVICES) {
          await expect(legend.getByTitle(service, { exact: true })).toBeVisible(
            { timeout: 30000 },
          );
        }
        await expect(legend.getByText('$1.00').first()).toBeVisible();
      });

      await test.step('An instant query draws the same slices, with no granularity', async () => {
        await editor.setPromqlQueryType('Instant');
        await editor.runQuery(false);

        await expect(editorGranularity).toBeHidden();
        await expect(legend.getByTitle(/.+/)).toHaveCount(SERVICES.length, {
          timeout: 30000,
        });
      });

      await test.step('The same query draws a bar per series', async () => {
        await editor.setChartType(DisplayType.Bar);
        await editor.runQuery(false);

        const bars = page.getByTestId('bar-chart-container');
        await expect(bars).toBeVisible({ timeout: 30000 });
        await expect(
          bars.getByText('accounting', { exact: true }),
        ).toBeVisible();
        await expect(page.getByTestId('order-by-input')).toBeHidden();
      });

      await test.step('The saved tile renders as a bar chart', async () => {
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(
          dashboardPage
            .getTiles()
            .first()
            .getByTestId('bar-chart-container')
            .getByText('accounting', { exact: true }),
        ).toBeVisible({ timeout: 30000 });
      });
    });
  },
);
