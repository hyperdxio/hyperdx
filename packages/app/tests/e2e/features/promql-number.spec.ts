/**
 * A PromQL number tile defaults to a range query reduced to its last non-null
 * sample, and the user can switch an expression to an instant query instead.
 * Either way the tile shows one value per series, so an expression that
 * resolves to several cannot be reduced to one number on the user's behalf:
 * the tile shows the first and warns.
 *
 * The seed gives `e2e_service_up` one series per `SERVICES` entry, labelled
 * `service`, so the bare metric is the multi-series case and a `service`
 * selector is the single-series case.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { E2E_PROMQL_METRIC_NAME, PROMQL_SOURCE_NAME } from '../utils/constants';

const ONE_SERIES = `${E2E_PROMQL_METRIC_NAME}{service="accounting"}`;

test.describe(
  'PromQL number tiles',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    test('shows a single value, and warns when the expression yields several', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;
      const value = page.getByTestId('number-chart-value');
      const warning = page.getByTestId('multiple-values-indicator');

      await test.step('Create a PromQL number tile', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await editor.switchToPromqlMode();
        await editor.selectPromqlSource(PROMQL_SOURCE_NAME);
        await editor.setChartName('PromQL number tile');
        await editor.setChartType(DisplayType.Number);
      });

      await test.step('A single-series expression shows its value, unwarned', async () => {
        await editor.replacePromqlExpression(ONE_SERIES);
        await editor.runQuery(false);

        await expect(value).toBeVisible({ timeout: 30000 });
        // The seed writes 1 for every sample of this series.
        await expect(value).toHaveText('1');
        await expect(warning).toBeHidden();
      });

      await test.step('A multi-series expression warns and shows the first value', async () => {
        await editor.replacePromqlExpression(E2E_PROMQL_METRIC_NAME);
        await editor.runQuery(false);

        await expect(warning).toBeVisible({ timeout: 30000 });
        // The tile still reports a number rather than blanking out.
        await expect(value).toBeVisible();

        await warning.hover();
        await expect(page.getByText('A number chart shows one')).toBeVisible();
      });

      await test.step('Aggregating the expression clears the warning', async () => {
        await editor.replacePromqlExpression(`sum(${E2E_PROMQL_METRIC_NAME})`);
        await editor.runQuery(false);

        await expect(warning).toBeHidden({ timeout: 30000 });
        await expect(value).toBeVisible();
      });

      await test.step('The tile keeps its value once saved', async () => {
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(page.getByTestId('number-chart-value')).toBeVisible({
          timeout: 30000,
        });
      });
    });

    test('reduces a range query with the chosen reducer', async ({ page }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;
      const value = page.getByTestId('number-chart-value');

      await test.step('Create a PromQL number tile', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await editor.switchToPromqlMode();
        await editor.selectPromqlSource(PROMQL_SOURCE_NAME);
        await editor.setChartName('PromQL range reducer tile');
        await editor.setChartType(DisplayType.Number);
        // Counts the samples in the window, so the reducer's effect on the
        // displayed value is unmistakable: the seed writes 1.0 every minute.
        await editor.replacePromqlExpression(ONE_SERIES);
        await editor.runQuery(false);
        await expect(value).toHaveText('1', { timeout: 30000 });

        // An expression that never chose ranges, and the control says so
        // rather than claiming the instant query it is not running.
        await expect(
          page.getByTestId('promql-query-type-control-0'),
        ).toContainText('Settings: Range');
      });

      await test.step('Count over the range reports more than one sample', async () => {
        await editor.setPromqlQueryType('Range', { reducer: 'Count' });
        await editor.runQuery(false);

        // Every sample is 1.0, so only a range query can report anything else.
        await expect(value).not.toHaveText('1', { timeout: 30000 });
      });

      await test.step('Switching back to instant restores the single value', async () => {
        await editor.setPromqlQueryType('Instant');
        await editor.runQuery(false);

        await expect(value).toHaveText('1', { timeout: 30000 });
      });

      await test.step('The controls stay open across a submit', async () => {
        await editor.setPromqlQueryType('Range', { reducer: 'Count' });
        await editor.runQuery(false);

        // Submitting resets the form; the disclosure must not collapse with it.
        await expect(
          page.getByTestId('promql-query-type-input-0'),
        ).toBeVisible();
      });

      await test.step('The granularity picker appears for a range query', async () => {
        // Hidden while every expression is instant: there is no resolution to
        // choose. A reduced range query reads it, so it appears.
        // Scoped to the editor: the dashboard header carries its own picker.
        const editorGranularity = page
          .getByTestId('tile-editor-form')
          .getByTestId('granularity-picker');
        await expect(editorGranularity).toBeVisible();

        await editor.setPromqlQueryType('Instant');
        await editor.runQuery(false);
        await expect(editorGranularity).toBeHidden();
      });

      await test.step('A background chart plots the range behind the value', async () => {
        await editor.setPromqlQueryType('Range', { reducer: 'Max' });
        await editor.setBackgroundChart('Area');
        await editor.runQuery(false);

        await expect(
          page.getByTestId('number-tile-background-chart'),
        ).toBeVisible({ timeout: 30000 });
      });

      await test.step('Switching to instant drops the background chart', async () => {
        await editor.setPromqlQueryType('Instant');
        await editor.runQuery(false);

        // An instant query has a single point, so there is no trend to plot.
        await expect(
          page.getByTestId('number-tile-background-chart'),
        ).toBeHidden();
      });

      await test.step('The range choice round-trips through a save', async () => {
        await editor.setPromqlQueryType('Range', { reducer: 'Count' });
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });

        await dashboardPage.editTile(0);
        await expect(editor.nameInput).toBeVisible();
        await expect(
          page.getByTestId('promql-query-type-control-0'),
        ).toContainText('Settings: Range / Count');
      });
    });
  },
);
