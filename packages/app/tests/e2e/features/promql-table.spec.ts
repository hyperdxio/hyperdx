/**
 * A PromQL table tile gives every Prometheus label its own column and sorts
 * client-side. A range query lists every sample — there is no reducer here, so
 * nothing collapses them — while an instant query lists one row per series and
 * has no time column at all. The tile's number format applies to the value
 * column only, and the columns survive a save and a reload.
 *
 * The seed gives `e2e_service_up` one series per `SERVICES` entry, labelled
 * `service`, one sample a minute.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { SERVICES } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import { E2E_PROMQL_METRIC_NAME, PROMQL_SOURCE_NAME } from '../utils/constants';

/**
 * Every seeded series. Written as a matcher rather than the bare metric name so
 * the editor's autocomplete popup closes on the trailing brace — left open it
 * covers the expression's own query type control.
 */
const ALL_SERIES = `${E2E_PROMQL_METRIC_NAME}{service!=""}`;

/** Case-insensitive, matching how the table sorts a string column. */
const BY_NAME = [...SERVICES].sort((a, b) =>
  a.toLowerCase().localeCompare(b.toLowerCase()),
);

test.describe(
  'PromQL table tiles',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    test('projects labels as sortable columns for range and instant queries', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;
      const timeColumn = page.getByRole('columnheader', {
        name: 'Timestamp',
        exact: true,
      });
      const serviceColumn = page.getByRole('columnheader', {
        name: 'service',
        exact: true,
      });
      // The editor page can hold more than one table; pin the one carrying the
      // PromQL label column.
      const table = page
        .getByRole('table')
        .filter({ has: serviceColumn })
        .first();

      await test.step('Create a PromQL table tile', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await expect(editor.nameInput).toBeVisible();
        await editor.waitForDataToLoad();
        await editor.switchToPromqlMode();
        await editor.selectPromqlSource(PROMQL_SOURCE_NAME);
        await editor.setChartName('PromQL table tile');
        await editor.setChartType(DisplayType.Table);
        await editor.replacePromqlExpression(ALL_SERIES);
        await editor.runQuery(false);
      });

      await test.step('A range query lists every sample, with a time column', async () => {
        await expect(timeColumn).toBeVisible({ timeout: 30000 });
        await expect(serviceColumn).toBeVisible();
        await expect(
          page.getByRole('columnheader', { name: '__name__', exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole('columnheader', { name: 'Value', exact: true }),
        ).toBeVisible();
        // A PromQL result is sorted by clicking a column, not a SQL clause.
        await expect(page.getByTestId('order-by-input')).toBeHidden();
        // One sample a minute per service, so there are more rows than series
        // even before scrolling the virtualized table.
        await expect(table.getByRole('row').nth(SERVICES.length)).toBeVisible();
      });

      await test.step('An instant query drops the time column and lists one row per series', async () => {
        await editor.setPromqlQueryType('Instant');
        await editor.runQuery(false);

        await expect(timeColumn).toBeHidden({ timeout: 30000 });
        await expect(serviceColumn).toBeVisible();
        // Filtered rather than counting every row: the virtualizer renders
        // spacer rows around the data ones.
        await expect(
          table.getByRole('row').filter({ hasText: E2E_PROMQL_METRIC_NAME }),
        ).toHaveCount(SERVICES.length);
      });

      await test.step('Clicking a label column sorts client-side, both ways', async () => {
        const firstRow = () =>
          table
            .getByRole('row')
            .filter({ hasText: E2E_PROMQL_METRIC_NAME })
            .first();

        await serviceColumn.click();
        await expect(
          firstRow().getByRole('cell', { name: BY_NAME[0], exact: true }),
        ).toBeVisible();

        await serviceColumn.click();
        await expect(
          firstRow().getByRole('cell', {
            name: BY_NAME[BY_NAME.length - 1],
            exact: true,
          }),
        ).toBeVisible();
      });

      await test.step('The tile offers no legend template or group-by placement', async () => {
        await editor.openDisplaySettings();
        await expect(page.getByTestId('legend-template-input')).toBeHidden();
        await expect(
          page
            .getByRole('dialog', { name: 'Display Settings' })
            .getByLabel('Display Group By Columns on Left'),
        ).toBeHidden();
        await editor.setNumberFormatOutput('Currency');
        await editor.applyDisplaySettings();
      });

      const expectSavedTile = async () => {
        await expect
          .poll(
            async () =>
              (await dashboardPage.getTileTableHeaders(0)).filter(Boolean),
            { timeout: 30000 },
          )
          .toEqual(['__name__', 'service', 'Value']);

        // Polled: the tile briefly shows its previous render after a save.
        await expect
          .poll(
            async () => {
              const values = await dashboardPage.getTileTableCellTexts(0, 2);
              return values.length > 0 && values.every(v => v.includes('$'));
            },
            { timeout: 15000 },
          )
          .toBe(true);
        const services = await dashboardPage.getTileTableCellTexts(0, 1);
        expect([...services].sort()).toEqual([...SERVICES].sort());
      };

      await test.step('The saved tile keeps its columns and formats only the value', async () => {
        await editor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expectSavedTile();
      });

      await test.step('The tile renders the same after a reload', async () => {
        await dashboardPage.reload();
        await expectSavedTile();
      });
    });
  },
);
