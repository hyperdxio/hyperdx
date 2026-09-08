/**
 * A `STATIC_LIST` dashboard filter offers a hand-authored list of values rather
 * than one queried from ClickHouse. With no expression there is nothing to
 * broadcast into a tile's `WHERE` clause, so the filter is a dashboard variable
 * and nothing else — and it is offered only where variables are.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { ServicesDashboardPage } from '../page-objects/ServicesDashboardPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../utils/constants';
import { expectFiltersParam } from '../utils/filters-param';

/**
 * Authored in an order that is not their sorted order, so "the dropdown lists
 * them as written" is distinguishable from "the dropdown sorts them".
 */
const ENVIRONMENTS = ['prod', 'staging', 'dev'];

test.describe(
  'Static list dashboard filters',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

    test('authors a filter with no source, expression or broadcast controls', async () => {
      test.setTimeout(90000);

      await test.step('Open the add-filter form and pick the static type', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openAddFilterForm();
        await expect(dashboardPage.getFilterTypePicker()).toBeVisible();
        // Filled before the switch: the display name belongs to both types, so
        // changing type must not discard it.
        await dashboardPage.getFilterNameInput().fill('Environment');
        await dashboardPage.selectFilterType('Static values');
        await expect(dashboardPage.getFilterNameInput()).toHaveValue(
          'Environment',
        );
      });

      await test.step('Only the fields a static filter has are rendered', async () => {
        const form = dashboardPage.getFilterForm();
        await expect(dashboardPage.getFilterNameInput()).toBeVisible();
        await expect(dashboardPage.getFilterOptionsInput()).toBeVisible();
        // Always a variable, so the name is asked for rather than unlocked by
        // a checkbox.
        await expect(dashboardPage.variableNameInput).toBeVisible();

        // Scoped to the form: these test ids are shared with the tile editor.
        await expect(form.getByTestId('source-selector')).toHaveCount(0);
        await expect(
          form.getByTestId('applies-to-source-selector'),
        ).toHaveCount(0);
        await expect(form.getByTestId('filter-broadcast-checkbox')).toHaveCount(
          0,
        );
        await expect(
          form.getByTestId('filter-variable-enabled-checkbox'),
        ).toHaveCount(0);
        // Covers both the filter expression and the dropdown values filter:
        // each is a CodeMirror editor, and the static form has neither.
        await expect(form.locator('div.cm-editor')).toHaveCount(0);
      });

      await test.step('The saved filter is summarized by its option count', async () => {
        await dashboardPage.fillFilterOptions(ENVIRONMENTS);
        await dashboardPage.variableNameInput.fill('env');
        await dashboardPage.page.getByTestId('save-filter-button').click();

        const item = dashboardPage.getFilterItemByName('Environment');
        await expect(item).toBeVisible();
        await expect(item).toContainText('3 custom options');
        await expect(item).toContainText('($env)');
      });
    });

    test('lists the options in author order and stores the selection by variable name', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await test.step('Create a static Environment filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ENVIRONMENTS,
          { variableName: 'env' },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('The dropdown offers the options as written, not sorted', async () => {
        await dashboardPage.openFilterDropdown('Environment');
        await expect(async () => {
          expect(await dashboardPage.getOpenFilterDropdownOptions()).toEqual(
            ENVIRONMENTS,
          );
        }).toPass({ timeout: 15000 });
        await page.keyboard.press('Escape');
      });

      await test.step('Selecting a value writes a variable-keyed entry', async () => {
        await dashboardPage.toggleFilterValue('Environment', 'prod');
        await expectFiltersParam(page, [
          { type: 'variable', name: 'env', values: ['prod'] },
        ]);
      });

      await test.step('The selection survives a reload', async () => {
        await page.reload();
        await dashboardPage.waitForLoaded();
        await expect(
          dashboardPage.getFilterPill('Environment', 'prod'),
        ).toBeVisible({ timeout: 20000 });
      });

      await test.step('A freeform value that is not on the list is accepted', async () => {
        await dashboardPage.typeFilterSearchValue('Environment', 'qa');
        await expect(dashboardPage.getFilterEmptyDropdownState()).toBeVisible();
        await dashboardPage.submitFilterSearchValue('Environment');

        await expectFiltersParam(page, [
          { type: 'variable', name: 'env', values: ['prod', 'qa'] },
        ]);
      });
    });

    test('narrows a raw SQL tile by the selected value', async () => {
      test.setTimeout(120000);
      const chartName = `E2E Static Filter Tile ${Date.now()}`;
      // The options double as real ServiceName values so the selection can be
      // seen to narrow a query, in an order that is not their sorted order.
      const services = ['frontend', 'accounting', 'ad'];
      const sql = `SELECT ServiceName, count() AS count FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) AND $__conditionalAll(ServiceName IN $svc, $svc) GROUP BY ServiceName LIMIT 200`;

      await test.step('Create a static Service filter and select one value', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Service',
          services,
          { variableName: 'svc' },
        );
        await dashboardPage.closeFiltersModal();
        await dashboardPage.toggleFilterValue('Service', 'accounting');
      });

      await test.step('Add a raw SQL tile that references the variable', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.setChartType(DisplayType.Table);
        await dashboardPage.chartEditor.setChartName(chartName);
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.typeSqlQuery(sql);
        await dashboardPage.chartEditor.runQuery(false);
        await dashboardPage.saveTile();
      });

      await test.step('The tile shows only the selected service', async () => {
        const tile = dashboardPage.getTiles().filter({ hasText: chartName });
        await expect(
          tile.getByTitle('accounting', { exact: true }),
        ).toBeVisible({ timeout: 20000 });
        await expect(tile.getByTitle('frontend', { exact: true })).toHaveCount(
          0,
        );
      });

      await test.step('Changing the selection re-renders the tile', async () => {
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await dashboardPage.toggleFilterValue('Service', 'frontend');

        const tile = dashboardPage.getTiles().filter({ hasText: chartName });
        await expect(tile.getByTitle('frontend', { exact: true })).toBeVisible({
          timeout: 20000,
        });
        await expect(
          tile.getByTitle('accounting', { exact: true }),
        ).toHaveCount(0);
      });
    });

    test('round-trips the options and variable name through an edit', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await test.step('Create a static Environment filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ENVIRONMENTS,
          { variableName: 'env' },
        );
      });

      await test.step('Reopening the form shows what was saved', async () => {
        await dashboardPage.openEditFilterForm('Environment');
        await expect(async () => {
          expect(await dashboardPage.getFilterOptionValues()).toEqual(
            ENVIRONMENTS,
          );
        }).toPass({ timeout: 10000 });
        await expect(dashboardPage.variableNameInput).toHaveValue('env');
        await expect(dashboardPage.getFilterTypePicker()).toBeVisible();
      });

      await test.step('An added option is saved', async () => {
        await dashboardPage.fillFilterOptions(['qa']);
        await dashboardPage.page.getByTestId('save-filter-button').click();
        await expect(
          dashboardPage.getFilterItemByName('Environment'),
        ).toContainText('4 custom options');
        await dashboardPage.closeFiltersModal();
      });

      await test.step('It survives a reload, still in author order', async () => {
        await page.reload();
        await dashboardPage.waitForLoaded();
        await dashboardPage.openFilterDropdown('Environment');
        await expect(async () => {
          expect(await dashboardPage.getOpenFilterDropdownOptions()).toEqual([
            ...ENVIRONMENTS,
            'qa',
          ]);
        }).toPass({ timeout: 15000 });
      });
    });

    test('converts a saved filter between the two types', async ({ page }) => {
      test.setTimeout(120000);

      await test.step('Create a static Environment filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ENVIRONMENTS,
          { variableName: 'env' },
        );
      });

      await test.step('Switching to queried values swaps in the queried fields', async () => {
        await dashboardPage.openEditFilterForm('Environment');
        await dashboardPage.selectFilterType('Queried values');
        await expect(dashboardPage.getFilterOptionsInput()).toHaveCount(0);

        await dashboardPage.selectFilterSource(DEFAULT_LOGS_SOURCE_NAME);
        await dashboardPage.fillFilterExpression('ServiceName');
        await page.getByTestId('save-filter-button').click();
      });

      await test.step('The conversion survives a reload, keeping $env', async () => {
        await dashboardPage.closeFiltersModal();
        await page.reload();
        await dashboardPage.waitForLoaded();
        await dashboardPage.openEditFiltersModal();

        const item = dashboardPage.getFilterItemByName('Environment');
        await expect(item).toContainText(DEFAULT_LOGS_SOURCE_NAME);
        await expect(item).toContainText('($env)');
        await expect(item).not.toContainText('custom options');
      });
    });

    test('is not offered on a dashboard that has no variables', async ({
      page,
    }) => {
      test.setTimeout(90000);

      // The services dashboard is the one preset dashboard, and preset filters
      // are broadcast-only: it renders the modal with `showVariableOptions`
      // off, which is also how every dashboard looks with the variables flag
      // disabled.
      const servicesPage = new ServicesDashboardPage(page);
      await servicesPage.goto();
      await servicesPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await servicesPage.openEditFiltersModal();
      await dashboardPage.openAddFilterForm();

      await expect(dashboardPage.getFilterNameInput()).toBeVisible();
      const form = dashboardPage.getFilterForm();
      await expect(form.getByTestId('filter-type-picker')).toHaveCount(0);
      await expect(form.getByTestId('filter-options-input')).toHaveCount(0);
    });
  },
);
