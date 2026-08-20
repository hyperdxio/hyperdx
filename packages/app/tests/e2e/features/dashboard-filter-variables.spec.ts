/**
 * A dashboard filter's "Dropdown values filter" may reference the dashboard's
 * other variables, so one filter's option list can be narrowed by another's
 * selection.
 *
 * Every test here is `@full-stack`: the option lists come from real ClickHouse
 * queries, and the dashboard-variables flag is only set on the full-stack
 * webServer (see playwright.config.ts).
 *
 * The seed data makes the narrowing checkable: default logs are generated with
 * `SERVICES[i % 10]` and `SEVERITIES[i % 4]`, so each service carries exactly
 * two of the four severities — `accounting` (index 5) has only warn and debug,
 * `api-server` (index 0) only info and error.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';

/** Severities `accounting` logs carry, and the two it does not. */
const ACCOUNTING_SEVERITIES = ['warn', 'debug'];
const OTHER_SEVERITIES = ['info', 'error'];
const ALL_SEVERITIES = [...ACCOUNTING_SEVERITIES, ...OTHER_SEVERITIES];

test.describe(
  "Dashboard variables in a filter's dropdown values query",
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

    /**
     * A dashboard with a `Service` filter exposed as `$svc` and a `Severity`
     * filter whose dropdown query is `where`.
     */
    const createDependentFilters = async (where: {
      value: string;
      language?: 'sql' | 'lucene';
    }) => {
      await dashboardPage.createNewDashboard();
      await dashboardPage.openEditFiltersModal();
      await dashboardPage.addFilterToDashboard(
        'Service',
        DEFAULT_LOGS_SOURCE_NAME,
        'ServiceName',
        undefined,
        undefined,
        { variableName: 'svc' },
      );
      await expect(dashboardPage.getFilterItemByName('Service')).toBeVisible();
      await dashboardPage.addFilterToDashboard(
        'Severity',
        DEFAULT_LOGS_SOURCE_NAME,
        'SeverityText',
        undefined,
        undefined,
        { variableName: 'sev' },
        where,
      );
      await expect(dashboardPage.getFilterItemByName('Severity')).toBeVisible();
      await dashboardPage.closeFiltersModal();
    };

    /**
     * Assert the Severity dropdown offers `visible` and none of `absent`.
     *
     * Asserted as a pair, and retried together: the values query reuses the
     * previous result as placeholder data while it refetches, so a snapshot of
     * only one of the two can pass against a stale list.
     */
    const expectSeverityOptions = async (
      visible: string[],
      absent: string[] = [],
    ) => {
      await expect(async () => {
        // Close first: a retry after a failed attempt would otherwise click an
        // already-open select, toggling it shut.
        await dashboardPage.page.keyboard.press('Escape');
        await dashboardPage.openFilterDropdown('Severity');
        for (const value of visible) {
          await expect(dashboardPage.getFilterOption(value)).toBeVisible({
            timeout: 1000,
          });
        }
        for (const value of absent) {
          await expect(dashboardPage.getFilterOption(value)).toHaveCount(0);
        }
      }).toPass({ timeout: 30000 });
      await dashboardPage.page.keyboard.press('Escape');
    };

    test('a $__filter macro narrows the dropdown to the selected service', async () => {
      test.setTimeout(120000);

      await test.step('Create a Severity filter that depends on $svc', async () => {
        await createDependentFilters({
          value: '$__filter(ServiceName, svc)',
          language: 'sql',
        });
      });

      await test.step('With nothing selected, every severity is still offered', async () => {
        // The macro expands to a no-op rather than holding the lookup back —
        // this fails loudly if the query is ever gated on the dependency.
        await expectSeverityOptions(ALL_SEVERITIES);
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Severity'),
        ).toBeHidden();
        await expect(dashboardPage.getFilterErrorIcon('Severity')).toBeHidden();
      });

      await test.step('Selecting a service narrows the severities to its own', async () => {
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await expectSeverityOptions(ACCOUNTING_SEVERITIES, OTHER_SEVERITIES);
      });

      await test.step('Changing the service swaps the severities', async () => {
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await dashboardPage.toggleFilterValue('Service', 'api-server');
        await expectSeverityOptions(OTHER_SEVERITIES, ACCOUNTING_SEVERITIES);
      });

      await test.step('Clearing the service restores every severity', async () => {
        await dashboardPage.toggleFilterValue('Service', 'api-server');
        await expectSeverityOptions(ALL_SEVERITIES);
      });
    });

    test('a Lucene dropdown query lists every value until its variable is selected', async () => {
      test.setTimeout(120000);

      await test.step('Create a Lucene Severity filter that depends on $svc', async () => {
        await createDependentFilters({
          value: 'ServiceName:$svc',
          language: 'lucene',
        });
      });

      await test.step('With nothing selected, every severity is still offered', async () => {
        // Lucene has no macro form, but an empty selection renders as `("")`,
        // whose empty term the query parser turns into `(1=1)`.
        await expectSeverityOptions(ALL_SEVERITIES);
        // So there is nothing to warn about, unlike the bare SQL form below.
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Severity'),
        ).toBeHidden();
      });

      await test.step('Selecting a service narrows the severities to its own', async () => {
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await expectSeverityOptions(ACCOUNTING_SEVERITIES, OTHER_SEVERITIES);
      });
    });

    test('a bare SQL reference warns while its variable has no value', async () => {
      test.setTimeout(120000);

      await test.step('Create a Severity filter using the bare reference form', async () => {
        await createDependentFilters({
          value: 'ServiceName IN ($svc)',
          language: 'sql',
        });
      });

      await test.step('With nothing selected the dropdown is empty, and says why', async () => {
        // `$svc` renders as NULL, so the clause matches no rows. The query
        // still runs — the filter reports the missing selection instead.
        const warning =
          dashboardPage.getFilterPendingVariableWarning('Severity');
        await expect(warning).toBeVisible();
        await warning.hover();
        await expect(
          dashboardPage.page.getByText(
            'Filter depends on $svc, which has no selected value.',
            { exact: false },
          ),
        ).toBeVisible();

        await dashboardPage.openFilterDropdown('Severity');
        await expect(dashboardPage.getFilterEmptyDropdownState()).toBeVisible({
          timeout: 20000,
        });
        await dashboardPage.page.keyboard.press('Escape');
      });

      await test.step('Selecting a service clears the warning and lists its severities', async () => {
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await expect(
          dashboardPage.getFilterPendingVariableWarning('Severity'),
        ).toBeHidden();
        await expectSeverityOptions(ACCOUNTING_SEVERITIES, OTHER_SEVERITIES);
      });
    });

    test('the dropdown values filter completes and validates variable references', async () => {
      test.setTimeout(120000);

      await test.step('Create a dashboard with a variable-enabled filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { variableName: 'svc' },
        );
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();
      });

      const filterForm = dashboardPage.getFilterForm();

      await test.step('Open the add-filter form on the logs source', async () => {
        await dashboardPage.openAddFilterForm();
        await expect(filterForm).toBeVisible();
        await dashboardPage.selectFilterSource(DEFAULT_LOGS_SOURCE_NAME);
      });

      await test.step('The dropdown values filter offers the variable', async () => {
        // Typed, not inserted: the completion popup only opens on input events.
        await dashboardPage.fillFilterDropdownValuesWhere({
          value: '$s',
          language: 'sql',
        });
        await dashboardPage.getFilterWhereSqlEditor().click();
        await dashboardPage.page.keyboard.press('End');
        await dashboardPage.page.keyboard.type('v');

        await expect(
          dashboardPage.page
            .locator('.cm-tooltip-autocomplete > ul > li')
            .filter({
              has: dashboardPage.page.getByText('$svc', { exact: true }),
            })
            .first(),
        ).toBeVisible({ timeout: 10000 });
      });

      await test.step('A macro in a Lucene clause is flagged', async () => {
        await dashboardPage.fillFilterDropdownValuesWhere({
          value: '$__filter(ServiceName, svc)',
          language: 'lucene',
        });
        const indicator = dashboardPage.getFilterWhereVariableWarning();
        await expect(indicator).toBeVisible({ timeout: 15000 });
        await expect(indicator).toHaveAttribute(
          'aria-label',
          /no meaning in a Lucene expression/,
        );
      });
    });
  },
);
