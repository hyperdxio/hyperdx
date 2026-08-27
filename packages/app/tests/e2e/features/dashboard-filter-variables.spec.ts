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
import { SERVICES } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  E2E_PROMQL_METRIC_NAME,
  PROMQL_SOURCE_NAME,
} from '../utils/constants';

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
          value: '$__filter(ServiceName, $svc)',
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
          value: '$__filter(ServiceName, $svc)',
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

/**
 * A PromQL tile interpolates the dashboard's variables into its expression.
 *
 * The seed gives `e2e_service_up` one series per `SERVICES` entry, labelled
 * `service` with the same values the logs carry in `ServiceName`, so the
 * dashboard filter's selections line up with the metric's labels.
 */
test.describe(
  'Dashboard variables in a PromQL tile',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    /** A fresh dashboard with a Service filter exposed as `$svc`. */
    const createDashboardWithServiceVariable = async (
      dashboardPage: DashboardPage,
    ) => {
      await dashboardPage.goto();
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
      await dashboardPage.closeFiltersModal();
    };

    /** Open a new tile's editor in PromQL mode, on the PromQL source. */
    const openPromqlTileEditor = async (dashboardPage: DashboardPage) => {
      await dashboardPage.addTile();
      await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      await dashboardPage.chartEditor.waitForDataToLoad();
      await dashboardPage.chartEditor.switchToPromqlMode();
      await dashboardPage.chartEditor.selectPromqlSource(PROMQL_SOURCE_NAME);
    };

    test('narrows the queried series to the selected values', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);

      // The time chart is a recharts AreaChart, so each returned series is one
      // `<g class="recharts-area">`.
      const seriesAreas = page
        .locator('.recharts-responsive-container')
        .first()
        .locator('.recharts-area');

      /**
       * Retried rather than snapshotted: the tile refetches on its own
       * schedule, so a single read can land before the selection change has
       * been queried.
       */
      const expectSeriesCount = async (count: number) => {
        await expect(seriesAreas).toHaveCount(count, { timeout: 30000 });
      };

      await test.step('Create a dashboard with a Service filter exposed as $svc', () =>
        createDashboardWithServiceVariable(dashboardPage));

      await test.step('Add a PromQL tile referencing $svc', async () => {
        await openPromqlTileEditor(dashboardPage);
        await dashboardPage.chartEditor.setChartName('PromQL tile');
        await dashboardPage.chartEditor.replacePromqlExpression(
          `${E2E_PROMQL_METRIC_NAME}{service=~"$svc"}`,
        );
        await dashboardPage.chartEditor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      await test.step('With nothing selected, every series comes back', async () => {
        // The empty selection renders as `.*`, so the tile is a valid query
        // that constrains nothing before anything is picked.
        await expectSeriesCount(SERVICES.length);
      });

      await test.step('Selecting one service narrows it to that series', async () => {
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await expectSeriesCount(1);
      });

      await test.step('Selecting a second widens it to an alternation', async () => {
        await dashboardPage.toggleFilterValue('Service', 'api-server');
        await expectSeriesCount(2);

        // Assert *which* two, so this can't pass on an unrelated pair: with
        // more than one series the legend qualifies each by its label.
        //
        // Matched on the tail rather than the whole name: the legend truncates
        // the middle past 35 characters, and `e2e_service_up{service="…"}` is
        // over that for both. The `"}` keeps this from matching the filter
        // dropdown's own bare `accounting` entry.
        const legend = page.locator('.recharts-legend-wrapper').first();
        for (const service of ['accounting', 'api-server']) {
          await expect(legend.getByText(`${service}"}`)).toBeVisible();
        }
      });

      await test.step('Clearing the selection restores every series', async () => {
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await dashboardPage.toggleFilterValue('Service', 'api-server');
        await expectSeriesCount(SERVICES.length);
      });
    });

    /**
     * The expression above is only writable if the editor tells you the
     * variable exists. Three completion sources share the PromQL input —
     * dashboard variables, metric names and PromQL's own functions and
     * keywords — and CodeMirror's `override` replaces language-registered
     * sources outright, so a mistake here silently costs one of the three.
     */
    test('offers the dashboard variables alongside metrics and functions', async ({
      page,
    }) => {
      test.setTimeout(120000);

      const dashboardPage = new DashboardPage(page);
      const editor = dashboardPage.chartEditor;

      await test.step('Open a PromQL tile on a dashboard with a variable', async () => {
        await createDashboardWithServiceVariable(dashboardPage);
        await openPromqlTileEditor(dashboardPage);
      });

      await test.step('A $ reference offers every PromQL-valid form', async () => {
        const labels = await editor.readPromqlCompletions('$sv', '${svc:csv}');
        expect(labels).toEqual(
          expect.arrayContaining(['$svc', '${svc}', '${svc:regex}']),
        );

        // Withheld on purpose: `'api', 'web'` and `("api" OR "web")` are SQL
        // and Lucene syntax that no PromQL expression can parse, and the
        // macros expand to SQL predicates that promql leaves as written.
        expect(labels).not.toContain('${svc:sqlstring}');
        expect(labels).not.toContain('${svc:lucene}');
        expect(labels).not.toContain('$__filter');
        expect(labels).not.toContain('$__conditionalAll');

        await editor.dismissCompletion();
      });

      await test.step("The reference's expansion is previewed in its help", async () => {
        await editor.replacePromqlExpression('$svc');
        const info = page.locator('.cm-completionInfo');
        await info.waitFor({ state: 'visible', timeout: 10000 });

        // Nothing is selected on this dashboard, and regex is promql's default
        // format — so the bare reference previews the match-everything state
        // that makes the tile above valid before anything is picked.
        await expect(info.locator('.cm-completionInfo-footnote')).toHaveText(
          'Expands to: .*',
        );

        await editor.dismissCompletion();
      });

      await test.step('Metric names and PromQL built-ins still complete', async () => {
        // The regression this feature could cause. Every source in the input
        // has to be listed in the one `override` array, including the
        // function/keyword source `PromQLExtension.asExtension()` registers
        // through language data — which `override` replaces outright.
        const metrics = await editor.readPromqlCompletions(
          E2E_PROMQL_METRIC_NAME.slice(0, 5),
          E2E_PROMQL_METRIC_NAME,
        );
        expect(metrics).toContain(E2E_PROMQL_METRIC_NAME);
        await editor.dismissCompletion();

        const functions = await editor.readPromqlCompletions('rat', 'rate');
        expect(functions).toContain('rate');
        await editor.dismissCompletion();
      });

      await test.step('Accepting a completion inserts well-formed text', async () => {
        // The replace range reaches forward over the rest of the reference,
        // which includes the `}` the editor auto-inserts after `${` — so
        // `apply` has to carry its own closing brace rather than rely on it.
        for (const [prefix, label, expected] of [
          ['${', '${svc}', '${svc}'],
          ['${', '${svc:regex}', '${svc:regex}'],
          ['$sv', '$svc', '$svc'],
          // The canonical form, typed the way a user would: the auto-closed
          // `"` and `}` sit after the cursor and must survive the insert.
          [
            `${E2E_PROMQL_METRIC_NAME}{service=~"$sv`,
            '$svc',
            `${E2E_PROMQL_METRIC_NAME}{service=~"$svc"}`,
          ],
        ]) {
          expect(await editor.acceptPromqlCompletion(prefix, label)).toBe(
            expected,
          );
        }
      });
    });
  },
);
