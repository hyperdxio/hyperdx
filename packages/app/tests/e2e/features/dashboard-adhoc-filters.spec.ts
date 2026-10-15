/**
 * An `ADHOC` dashboard filter's conditions (`key operator value`) are picked
 * from the keys of its sources. For now the filters modal only lists, creates,
 * and edits them; they are not rendered or applied on the dashboard.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
  PROMQL_SOURCE_NAME,
} from '../utils/constants';

test.describe(
  'Ad hoc dashboard filters',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

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

      await test.step('Only the other filter is rendered on the dashboard', async () => {
        await dashboardPage.closeFiltersModal();
        await expect(
          dashboardPage.getFilterSelectByName('Environment'),
        ).toBeVisible();
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
  },
);
