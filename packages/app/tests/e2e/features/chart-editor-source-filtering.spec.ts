/**
 * The tile editor's Data Source picker only lists sources the current editor
 * mode and display type can query: PromQL sources sit on ClickHouse TimeSeries
 * tables that the builder and raw SQL paths cannot read. Switching mode or
 * display type swaps a selection that stops being valid for the first source
 * the picker still offers.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
  PROMQL_SOURCE_NAME,
} from '../utils/constants';

test.describe(
  'Chart editor data source filtering',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    test('offers PromQL sources in PromQL mode only, and swaps invalid selections', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;

      await dashboardPage.goto();
      await dashboardPage.openNewTileEditor();

      await test.step('Builder mode leaves PromQL sources out of the picker', async () => {
        await editor.selectSource(DEFAULT_LOGS_SOURCE_NAME);
        await expect(editor.source).toHaveValue(DEFAULT_LOGS_SOURCE_NAME);

        await editor.openSourcePicker();
        await expect(
          editor.sourceOption(DEFAULT_TRACES_SOURCE_NAME),
        ).toBeVisible();
        await expect(editor.sourceOption(PROMQL_SOURCE_NAME)).toHaveCount(0);
        await editor.closeSourcePicker();
      });

      await test.step('SQL mode leaves PromQL sources out of the picker', async () => {
        await editor.switchToSqlMode();
        await editor.openSourcePicker();
        await expect(editor.sourceOption(PROMQL_SOURCE_NAME)).toHaveCount(0);
        await editor.closeSourcePicker();
      });

      await test.step('PromQL mode swaps in a PromQL source and offers nothing else', async () => {
        await editor.switchToPromqlMode();
        await expect(editor.source).toHaveValue(PROMQL_SOURCE_NAME);

        await editor.openSourcePicker();
        await expect(editor.sourceOption(DEFAULT_LOGS_SOURCE_NAME)).toHaveCount(
          0,
        );
        await editor.closeSourcePicker();
      });

      await test.step('Switching back to the builder restores a queryable source', async () => {
        await editor.switchToBuilderMode();
        await expect(editor.source).not.toHaveValue(PROMQL_SOURCE_NAME);
        await expect(editor.source).not.toHaveValue('');
      });

      await test.step('A display type PromQL cannot render swaps the source out', async () => {
        await editor.switchToPromqlMode();
        await expect(editor.source).toHaveValue(PROMQL_SOURCE_NAME);

        await editor.setChartType(DisplayType.Search);
        await expect(editor.source).not.toHaveValue(PROMQL_SOURCE_NAME);
        await editor.openSourcePicker();
        await expect(editor.sourceOption(PROMQL_SOURCE_NAME)).toHaveCount(0);
        await editor.closeSourcePicker();
      });
    });

    test('keeps a queryable source across display type changes, and swaps for heatmaps', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;

      await dashboardPage.goto();
      await dashboardPage.openNewTileEditor();
      await editor.selectSource(DEFAULT_LOGS_SOURCE_NAME);

      await test.step('A source the new display type can query is left alone', async () => {
        await editor.setChartType(DisplayType.Table);
        await expect(editor.source).toHaveValue(DEFAULT_LOGS_SOURCE_NAME);
      });

      await test.step('Heatmap swaps in the first trace source', async () => {
        await editor.setChartType(DisplayType.Heatmap);
        // Heatmaps read a duration, so only trace sources qualify; the picker
        // sorts by name, putting `E2E Traces` ahead of the two MV variants.
        await expect(editor.source).toHaveValue(DEFAULT_TRACES_SOURCE_NAME);

        await editor.openSourcePicker();
        await expect(editor.sourceOption(DEFAULT_LOGS_SOURCE_NAME)).toHaveCount(
          0,
        );
        await editor.closeSourcePicker();
      });
    });
  },
);
