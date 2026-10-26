/**
 * An `ADHOC` dashboard filter's conditions (`key operator value`) are picked
 * from the keys of its sources. The filters modal creates and edits them, and
 * the dashboard renders their conditions and keeps them in the URL. Conditions
 * of a SQL filter are broadcast to builder tiles and to raw SQL tiles through
 * `$__filters`; those of a PromQL filter are added to every selector of PromQL
 * tiles.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { SERVICES } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
  E2E_PROMQL_METRIC_NAME,
  PROMQL_SOURCE_NAME,
} from '../utils/constants';
import { expectFiltersParam, filtersParam } from '../utils/filters-param';

test.describe(
  'Ad hoc dashboard filters',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

    /** Create a dashboard holding one ad hoc filter, and close the modal. */
    const createDashboardWithAdhocFilter = async (
      ...args: Parameters<DashboardPage['addAdhocFilterToDashboard']>
    ) => {
      await dashboardPage.createNewDashboard();
      await dashboardPage.openEditFiltersModal();
      await dashboardPage.addAdhocFilterToDashboard(...args);
      await dashboardPage.closeFiltersModal();
    };

    test('authors a SQL filter over several sources', async ({ page }) => {
      await test.step('Open the add-filter form and pick the ad hoc type', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openAddFilterForm();
        await dashboardPage.getFilterNameInput().fill('Conditions');
        await dashboardPage.selectFilterType('Ad hoc keys and values');
        await expect(dashboardPage.getFilterNameInput()).toHaveValue(
          'Conditions',
        );
      });

      await test.step('Only the fields an ad hoc filter has are rendered', async () => {
        const form = dashboardPage.getFilterForm();
        await expect(
          dashboardPage.getAdhocFilterSourceTypeControl(),
        ).toBeVisible();
        await expect(dashboardPage.getAdhocFilterSourcesInput()).toBeVisible();
        await expect(dashboardPage.broadcastFilterCheckbox).toBeChecked();
        await expect(dashboardPage.appliesToSourceSelector).toBeVisible();
        // Always a variable, so the name is asked for rather than unlocked by
        // a checkbox.
        await expect(dashboardPage.variableNameInput).toBeVisible();

        await expect(form.getByTestId('source-selector')).toHaveCount(0);
        await expect(form.locator('div.cm-editor')).toHaveCount(0);
        await expect(
          form.getByTestId('filter-variable-enabled-checkbox'),
        ).toHaveCount(0);
        await expect(dashboardPage.requiredFilterCheckbox).toHaveCount(0);
        await expect(dashboardPage.singleSelectCheckbox).toHaveCount(0);
      });

      await test.step('Saving without a source is rejected', async () => {
        await page.getByTestId('save-filter-button').click();
        await expect(
          dashboardPage.getFilterForm().getByText('Select at least one source'),
        ).toBeVisible();
      });

      await test.step('Only SQL sources without a metric type are offered', async () => {
        await dashboardPage.getAdhocFilterSourcesInput().click();
        await expect(
          dashboardPage.getFilterOption(DEFAULT_LOGS_SOURCE_NAME),
        ).toBeVisible();
        await expect(
          dashboardPage.getFilterOption(DEFAULT_TRACES_SOURCE_NAME),
        ).toBeVisible();
        await expect(
          dashboardPage.getFilterOption(DEFAULT_METRICS_SOURCE_NAME),
        ).toHaveCount(0);
        await expect(
          dashboardPage.getFilterOption(PROMQL_SOURCE_NAME),
        ).toHaveCount(0);
        await page.keyboard.press('Escape');
      });

      await test.step('The saved filter is summarized by its sources', async () => {
        await dashboardPage.selectSourcesInMultiSelect(
          dashboardPage.getAdhocFilterSourcesInput(),
          [DEFAULT_LOGS_SOURCE_NAME, DEFAULT_TRACES_SOURCE_NAME],
        );
        await dashboardPage.variableNameInput.fill('conds');
        await page.getByTestId('save-filter-button').click();

        const item = dashboardPage.getFilterItemByName('Conditions');
        await expect(item).toBeVisible();
        await expect(item).toContainText(
          `${DEFAULT_LOGS_SOURCE_NAME}, ${DEFAULT_TRACES_SOURCE_NAME}`,
        );
        await expect(item).toContainText('($conds)');
        await expect(
          dashboardPage.getFilterBroadcastTarget('Conditions'),
        ).toHaveText(
          `${DEFAULT_LOGS_SOURCE_NAME}, ${DEFAULT_TRACES_SOURCE_NAME}`,
        );
      });

      await test.step('The filter survives a reload', async () => {
        await dashboardPage.closeFiltersModal();
        await page.reload();
        await dashboardPage.waitForLoaded();
        await dashboardPage.openEditFiltersModal();
        await expect(
          dashboardPage.getFilterItemByName('Conditions'),
        ).toContainText('($conds)');
      });
    });

    test('edits the broadcast scope and variable name of a saved filter', async ({
      page,
    }) => {
      await test.step('Create a SQL ad hoc filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addAdhocFilterToDashboard(
          'Conditions',
          [DEFAULT_LOGS_SOURCE_NAME, DEFAULT_TRACES_SOURCE_NAME],
          { variableName: 'conds' },
        );
      });

      await test.step('The edit form loads the saved values', async () => {
        await dashboardPage.openEditFilterForm('Conditions');
        const form = dashboardPage.getFilterForm();
        await expect(dashboardPage.getFilterTypePicker()).toHaveValue(
          'Ad hoc keys and values',
        );
        await expect(
          form.getByText(DEFAULT_LOGS_SOURCE_NAME, { exact: true }),
        ).toBeVisible();
        await expect(
          form.getByText(DEFAULT_TRACES_SOURCE_NAME, { exact: true }),
        ).toBeVisible();
        await expect(dashboardPage.variableNameInput).toHaveValue('conds');
      });

      await test.step('Narrow the broadcast to one source', async () => {
        await dashboardPage.selectSourcesInMultiSelect(
          dashboardPage.appliesToSourceSelector,
          [DEFAULT_TRACES_SOURCE_NAME],
        );
        await dashboardPage.variableNameInput.fill('where_clause');
        await page.getByTestId('save-filter-button').click();

        await expect(
          dashboardPage.getFilterItemByName('Conditions'),
        ).toContainText('($where_clause)');
        await expect(
          dashboardPage.getFilterBroadcastTarget('Conditions'),
        ).toHaveText(DEFAULT_TRACES_SOURCE_NAME);
      });

      await test.step('Turning broadcast off drops the broadcast attribute', async () => {
        await dashboardPage.openEditFilterForm('Conditions');
        await dashboardPage.broadcastFilterCheckbox.uncheck();
        await expect(dashboardPage.appliesToSourceSelector).toHaveCount(0);
        await page.getByTestId('save-filter-button').click();

        await expect(
          dashboardPage.getFilterItemByName('Conditions'),
        ).toBeVisible();
        await expect(
          dashboardPage.getFilterBroadcastTarget('Conditions'),
        ).toHaveCount(0);
      });

      await test.step('The edits survive a reload', async () => {
        await page.reload();
        await dashboardPage.waitForLoaded();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openEditFilterForm('Conditions');
        await expect(dashboardPage.broadcastFilterCheckbox).not.toBeChecked();
        await expect(dashboardPage.variableNameInput).toHaveValue(
          'where_clause',
        );
      });
    });

    test('authors a PromQL filter', async ({ page }) => {
      await test.step('Switching source type clears the picked sources', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openAddFilterForm();
        await dashboardPage.getFilterNameInput().fill('Labels');
        await dashboardPage.selectFilterType('Ad hoc keys and values');
        await dashboardPage.selectSourcesInMultiSelect(
          dashboardPage.getAdhocFilterSourcesInput(),
          [DEFAULT_LOGS_SOURCE_NAME],
        );
        const form = dashboardPage.getFilterForm();
        await expect(
          form.getByText(DEFAULT_LOGS_SOURCE_NAME, { exact: true }),
        ).toBeVisible();

        await dashboardPage.selectAdhocFilterSourceType('Prometheus');
        await expect(
          form.getByText(DEFAULT_LOGS_SOURCE_NAME, { exact: true }),
        ).toHaveCount(0);
      });

      await test.step('Only PromQL sources are offered', async () => {
        await dashboardPage.getAdhocFilterSourcesInput().click();
        await expect(
          dashboardPage.getFilterOption(PROMQL_SOURCE_NAME),
        ).toBeVisible();
        await expect(
          dashboardPage.getFilterOption(DEFAULT_LOGS_SOURCE_NAME),
        ).toHaveCount(0);
        await dashboardPage.getFilterOption(PROMQL_SOURCE_NAME).click();
        await page.keyboard.press('Escape');
      });

      await test.step('The saved filter keeps its source type', async () => {
        await page.getByTestId('save-filter-button').click();
        await expect(dashboardPage.getFilterItemByName('Labels')).toContainText(
          PROMQL_SOURCE_NAME,
        );

        await dashboardPage.openEditFilterForm('Labels');
        await expect(
          dashboardPage
            .getAdhocFilterSourceTypeControl()
            .getByRole('radio', { name: 'Prometheus' }),
        ).toBeChecked();
      });
    });

    test('rejects broadcast sources carried over from another filter type', async ({
      page,
    }) => {
      await dashboardPage.createNewDashboard();
      await dashboardPage.openEditFiltersModal();
      await dashboardPage.openAddFilterForm();
      await dashboardPage.getFilterNameInput().fill('Conditions');
      await dashboardPage.selectSourcesInMultiSelect(
        dashboardPage.appliesToSourceSelector,
        [DEFAULT_METRICS_SOURCE_NAME],
      );

      await dashboardPage.selectFilterType('Ad hoc keys and values');
      await dashboardPage.selectSourcesInMultiSelect(
        dashboardPage.getAdhocFilterSourcesInput(),
        [DEFAULT_LOGS_SOURCE_NAME],
      );
      await page.getByTestId('save-filter-button').click();

      await expect(
        dashboardPage
          .getFilterForm()
          .getByText('Select only log, trace, or session sources'),
      ).toBeVisible();
    });

    test('picks conditions from the keys and values of one SQL source', async ({
      page,
    }) => {
      const filterName = 'Conditions';
      const pills = dashboardPage.getAdhocConditionPills(filterName);

      await test.step('Create the filter', async () => {
        await createDashboardWithAdhocFilter(
          filterName,
          [DEFAULT_LOGS_SOURCE_NAME],
          { variableName: 'conds' },
        );
        await expect(dashboardPage.getAdhocFilter(filterName)).toBeVisible();
      });

      await test.step('Keys are suggested, values only once a key is picked', async () => {
        const editor = dashboardPage.getAdhocConditionEditor(filterName);
        const valueInput = dashboardPage.getAdhocConditionInput(
          filterName,
          'value',
        );
        const serviceNameOption = dashboardPage.getAdhocConditionOption(
          filterName,
          'ServiceName',
        );
        const accountingOption = dashboardPage.getAdhocConditionOption(
          filterName,
          'accounting',
        );

        await dashboardPage.openAddAdhocCondition(filterName);
        await valueInput.click();
        await expect(editor.getByRole('option')).toHaveCount(0);

        await dashboardPage.getAdhocConditionInput(filterName, 'key').click();
        await expect(serviceNameOption).toBeVisible({ timeout: 30000 });
        await serviceNameOption.click();

        await valueInput.click();
        await expect(accountingOption).toBeVisible({ timeout: 30000 });
        await accountingOption.click();
        await valueInput.press('Enter');
        await expect(editor).toBeHidden();
      });

      await test.step('The condition is shown and kept in the URL', async () => {
        await expect(pills).toHaveCount(1);
        await expect(pills).toHaveText('ServiceName = accounting');
        await expectFiltersParam(page, [
          {
            type: 'adhoc',
            name: 'conds',
            conditions: [
              { key: 'ServiceName', operator: '=', value: 'accounting' },
            ],
          },
        ]);
      });

      await test.step('Editing the pill changes its operator', async () => {
        await dashboardPage.editAdhocCondition(
          filterName,
          'ServiceName = accounting',
          { operatorLabel: '!=' },
        );
        await expect(pills).toHaveText('ServiceName != accounting');
        await expectFiltersParam(page, [
          {
            type: 'adhoc',
            name: 'conds',
            conditions: [
              { key: 'ServiceName', operator: '!=', value: 'accounting' },
            ],
          },
        ]);
      });

      await test.step('The condition survives a reload', async () => {
        await page.reload();
        await dashboardPage.waitForLoaded();
        await expect(pills).toHaveText('ServiceName != accounting');
      });

      await test.step('Removing the pill clears it from the URL', async () => {
        await pills.getByRole('button', { name: 'Remove filter' }).click();
        await expect(pills).toHaveCount(0);
        await expect.poll(() => filtersParam(page) ?? []).toEqual([]);
      });
    });

    test('offers deduplicated keys and values across several SQL sources', async ({
      page,
    }) => {
      const filterName = 'Both';
      const pills = dashboardPage.getAdhocConditionPills(filterName);

      await test.step('Create a filter over logs and traces', async () => {
        await createDashboardWithAdhocFilter(
          filterName,
          [DEFAULT_LOGS_SOURCE_NAME, DEFAULT_TRACES_SOURCE_NAME],
          { variableName: 'both' },
        );
      });

      const keyInput = dashboardPage.getAdhocConditionInput(filterName, 'key');

      await test.step('A key both sources have is listed once', async () => {
        await dashboardPage.openAddAdhocCondition(filterName);
        // Typing narrows the list, which renders at most 200 suggestions.
        await keyInput.fill('ServiceName');
        await expect(
          dashboardPage.getAdhocConditionOption(filterName, 'ServiceName'),
        ).toHaveCount(1, { timeout: 30000 });
      });

      await test.step('A key only one source has is offered too', async () => {
        await keyInput.fill('SpanName');
        await expect(
          dashboardPage.getAdhocConditionOption(filterName, 'SpanName'),
        ).toHaveCount(1);
      });

      await test.step("The key's values are listed once each", async () => {
        await keyInput.fill('ServiceName');
        await dashboardPage.getAdhocConditionInput(filterName, 'value').click();
        await expect(
          dashboardPage.getAdhocConditionOption(filterName, 'accounting'),
        ).toHaveCount(1, { timeout: 30000 });
        const options = await dashboardPage.getOpenFilterDropdownOptions();
        expect(new Set(options).size).toBe(options.length);
        expect(options).toEqual(expect.arrayContaining([...SERVICES]));
        await dashboardPage.fillAdhocConditionEditor(filterName, {
          value: 'accounting',
        });
      });

      await test.step('A key only one source has gets its values', async () => {
        await dashboardPage.openAddAdhocCondition(filterName);
        await keyInput.fill('SeverityText');
        await dashboardPage.getAdhocConditionInput(filterName, 'value').click();
        await expect(
          dashboardPage.getAdhocConditionOption(filterName, 'error'),
        ).toBeVisible({ timeout: 30000 });
        await dashboardPage.fillAdhocConditionEditor(filterName, {
          value: 'error',
        });
      });

      await test.step('Both conditions survive a reload', async () => {
        await expect(pills).toHaveText([
          'ServiceName = accounting',
          'SeverityText = error',
        ]);
        await page.reload();
        await dashboardPage.waitForLoaded();
        await expect(pills).toHaveText([
          'ServiceName = accounting',
          'SeverityText = error',
        ]);
      });
    });

    test('picks conditions from the labels of a PromQL source', async () => {
      const filterName = 'Labels';

      await createDashboardWithAdhocFilter(filterName, [PROMQL_SOURCE_NAME], {
        sourceType: 'Prometheus',
      });

      await dashboardPage.openAddAdhocCondition(filterName);
      await dashboardPage.getAdhocConditionInput(filterName, 'key').click();
      await expect(
        dashboardPage.getAdhocConditionOption(filterName, 'service'),
      ).toBeVisible({ timeout: 30000 });
      await expect(
        dashboardPage.getAdhocConditionOption(filterName, '__name__'),
      ).toHaveCount(0);

      await dashboardPage
        .getAdhocConditionInput(filterName, 'key')
        .fill('service');
      await dashboardPage.getAdhocConditionInput(filterName, 'value').click();
      await expect(
        dashboardPage.getAdhocConditionOption(filterName, 'accounting'),
      ).toBeVisible({ timeout: 30000 });
      await dashboardPage.fillAdhocConditionEditor(filterName, {
        operatorLabel: '=~',
        value: 'acc.*',
      });
      await expect(dashboardPage.getAdhocConditionPills(filterName)).toHaveText(
        'service =~ acc.*',
      );
    });

    test("lives alongside the dashboard's other filters", async ({ page }) => {
      await test.step('Create an ad hoc and a static filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addAdhocFilterToDashboard(
          'Conditions',
          [DEFAULT_LOGS_SOURCE_NAME],
          { variableName: 'conds' },
        );
        await dashboardPage.addStaticListFilterToDashboard('Environment', [
          'prod',
        ]);
      });

      await test.step('Other filters cannot reuse its variable name', async () => {
        await dashboardPage.openEditFilterForm('Environment');
        await dashboardPage.variableNameInput.fill('conds');
        await page.getByTestId('save-filter-button').click();
        await expect(
          dashboardPage
            .getFilterForm()
            .getByText(
              'This variable name is used by another filter on this dashboard (Conditions)',
            ),
        ).toBeVisible();
        await page.getByRole('button', { name: 'Cancel' }).click();
      });

      await test.step('Both filters are rendered on the dashboard', async () => {
        await dashboardPage.closeFiltersModal();
        await expect(
          dashboardPage.getFilterSelectByName('Environment'),
        ).toBeVisible();
        await expect(dashboardPage.getAdhocFilter('Conditions')).toBeVisible();
        await expect(
          dashboardPage.getFilterSelectByName('Conditions'),
        ).toHaveCount(0);
      });

      await test.step('Deleting it leaves the other filter in place', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.deleteFilterFromDashboard('Conditions');
        await expect(
          dashboardPage.getFilterItemByName('Conditions'),
        ).toHaveCount(0);
        await expect(
          dashboardPage.getFilterItemByName('Environment'),
        ).toBeVisible();
      });
    });

    test('narrows builder and raw SQL tiles by its conditions', async () => {
      const filterName = 'Conditions';
      const sql = `SELECT ServiceName, count() AS count FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) AND $__filters GROUP BY ServiceName LIMIT 200`;
      const expectServices = async (shown: string[], hidden: string[]) => {
        for (const tile of [
          dashboardPage.getTile(0),
          dashboardPage.getTile(1),
        ]) {
          for (const service of shown) {
            await expect(tile.getByTitle(service, { exact: true })).toBeVisible(
              { timeout: 20000 },
            );
          }
          for (const service of hidden) {
            await expect(tile.getByTitle(service, { exact: true })).toHaveCount(
              0,
            );
          }
        }
      };

      await test.step('Add a builder tile and a raw SQL tile on the logs source', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createTable({
          chartName: 'Builder tile',
          sourceName: DEFAULT_LOGS_SOURCE_NAME,
          groupBy: 'ServiceName',
        });
        await expect(dashboardPage.getTiles()).toHaveCount(1);

        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.setChartType(DisplayType.Table);
        await dashboardPage.chartEditor.setChartName('Raw SQL tile');
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.selectSource(DEFAULT_LOGS_SOURCE_NAME);
        await dashboardPage.chartEditor.typeSqlQuery(sql);
        await dashboardPage.chartEditor.runQuery(false);
        await dashboardPage.saveTile();
        await expect(dashboardPage.getTiles()).toHaveCount(2);
      });

      await test.step('Create the filter on the logs source', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addAdhocFilterToDashboard(filterName, [
          DEFAULT_LOGS_SOURCE_NAME,
        ]);
        await dashboardPage.closeFiltersModal();
        await expectServices(['accounting', 'frontend'], []);
      });

      await test.step('An = condition keeps only the matching service', async () => {
        await dashboardPage.openAddAdhocCondition(filterName);
        await dashboardPage.fillAdhocConditionEditor(filterName, {
          key: 'ServiceName',
          value: 'accounting',
        });
        await expectServices(['accounting'], ['frontend']);
      });

      await test.step('A != condition excludes the service', async () => {
        await dashboardPage.editAdhocCondition(
          filterName,
          'ServiceName = accounting',
          { operatorLabel: '!=' },
        );
        await expectServices(['frontend'], ['accounting']);
      });
    });

    test('narrows PromQL tiles by its label matchers', async () => {
      const filterName = 'Labels';
      // One `<g class="recharts-area">` per returned series.
      const seriesAreas = dashboardPage.getTile(0).locator('.recharts-area');

      await test.step('Add a PromQL tile with no matchers', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.switchToPromqlMode();
        await dashboardPage.chartEditor.selectSource(PROMQL_SOURCE_NAME);
        await dashboardPage.chartEditor.setChartName('PromQL tile');
        await dashboardPage.chartEditor.replacePromqlExpression(
          E2E_PROMQL_METRIC_NAME,
        );
        await dashboardPage.chartEditor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1);
        await expect(seriesAreas).toHaveCount(SERVICES.length, {
          timeout: 20000,
        });
      });

      await test.step('Create the filter on the PromQL source', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addAdhocFilterToDashboard(
          filterName,
          [PROMQL_SOURCE_NAME],
          { sourceType: 'Prometheus' },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('An = condition keeps only the matching series', async () => {
        await dashboardPage.openAddAdhocCondition(filterName);
        await dashboardPage.fillAdhocConditionEditor(filterName, {
          key: 'service',
          value: 'accounting',
        });
        await expect(seriesAreas).toHaveCount(1, { timeout: 20000 });
      });

      await test.step('A != condition excludes the series', async () => {
        await dashboardPage.editAdhocCondition(
          filterName,
          'service = accounting',
          { operatorLabel: '!=' },
        );
        await expect(seriesAreas).toHaveCount(SERVICES.length - 1, {
          timeout: 20000,
        });
        // The legend truncates long series names, so match on the tail.
        await expect(
          dashboardPage.getTile(0).getByText('accounting"}'),
        ).toHaveCount(0);
      });

      await test.step('The tile editor previews the added matcher', async () => {
        const editor = dashboardPage.chartEditor;
        await dashboardPage.editTile(0);
        await editor.runQuery();
        await editor.openGeneratedPromql();
        await expect
          .poll(() => editor.getGeneratedPromqlText())
          .toBe(`${E2E_PROMQL_METRIC_NAME}{service!="accounting"}`);
      });
    });
  },
);
