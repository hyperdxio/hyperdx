/**
 * A dashboard filter marked required (`minSelections: 1`) blocks tiles until it
 * has a selected value: each blocked tile renders a "Missing required filters"
 * placeholder instead of querying. By default only the tiles that read the
 * filter are blocked - the ones referencing its variable, and the ones its
 * broadcast reaches. Checking "Block every tile" (`isGlobalRequirement: true`)
 * widens that to the whole dashboard. Markdown tiles are never blocked.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
  E2E_PROMQL_METRIC_NAME,
  PROMQL_SOURCE_NAME,
} from '../utils/constants';

const ENVIRONMENTS = ['prod', 'staging', 'dev'];

test.describe(
  'Required dashboard filters',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

    /** A tile shows the placeholder, naming the filters it is waiting on. */
    const expectTileBlockedOn = async (
      tileIndex: number,
      filterNames: string,
    ) => {
      const placeholder =
        dashboardPage.getTileMissingRequiredFilters(tileIndex);
      await expect(placeholder).toBeVisible({ timeout: 20000 });
      await expect(placeholder).toContainText(
        `Missing required filters: ${filterNames}`,
      );
    };

    /** A tile is past the placeholder and has rendered its value. */
    const expectTileLoaded = async (tileIndex: number) => {
      await expect(
        dashboardPage.getTileMissingRequiredFilters(tileIndex),
      ).toHaveCount(0, { timeout: 20000 });
      await expect(dashboardPage.getNumberTileValue(tileIndex)).toBeVisible({
        timeout: 30000,
      });
    };

    test('blocks a data tile but never a markdown tile', async () => {
      test.setTimeout(150000);

      await test.step('Create a data tile, a markdown tile, and a required filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.addMarkdownTile('Notes', 'Runbook notes');
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ENVIRONMENTS,
          { variableName: 'env', required: true, globalRequirement: true },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('The data tile is blocked and the markdown tile still renders', async () => {
        await expectTileBlockedOn(0, 'Environment');
        // No chart component is mounted at all, which is what keeps the tile
        // from querying rather than merely hiding a result it fetched.
        await expect(dashboardPage.getNumberTileValue(0)).toHaveCount(0);
        await expect(dashboardPage.getTileError(0)).toHaveCount(0);

        await expect(
          dashboardPage.getTileMissingRequiredFilters(1),
        ).toHaveCount(0);
        await expect(
          dashboardPage.getTile(1).getByText('Runbook notes'),
        ).toBeVisible();
      });

      await test.step('Selecting a value unblocks the data tile', async () => {
        await dashboardPage.toggleFilterValue('Environment', 'prod');

        await expectTileLoaded(0);
      });

      await test.step('Clearing the value blocks it again', async () => {
        await dashboardPage.toggleFilterValue('Environment', 'prod');

        await expectTileBlockedOn(0, 'Environment');
      });
    });

    // "Block every tile" ignores scope entirely: a filter scoped away from a
    // tile still blocks it.
    test('blocks every tile, including one the filter does not apply to', async () => {
      test.setTimeout(150000);

      await test.step('Scope a required filter to traces, and add a logs tile', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addNumberTile(
          'Logs count',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_TRACES_SOURCE_NAME,
          'ServiceName',
          undefined,
          [DEFAULT_TRACES_SOURCE_NAME],
          { required: true, globalRequirement: true },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('The logs tile is blocked even though the filter never reaches it', async () => {
        await expectTileBlockedOn(0, 'Service');
      });

      await test.step('Satisfying the filter loads it', async () => {
        await dashboardPage.toggleFilterValue('Service', 'frontend');

        await expectTileLoaded(0);
      });
    });

    test('blocks only the tiles a broadcast reaches', async () => {
      test.setTimeout(180000);

      await test.step('Add a logs tile, a traces tile, and a traces-only scoped requirement', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addNumberTile(
          'Logs count',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.addNumberTile(
          'Traces count',
          DEFAULT_TRACES_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_TRACES_SOURCE_NAME,
          'ServiceName',
          undefined,
          [DEFAULT_TRACES_SOURCE_NAME],
          { required: true },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('Only the traces tile is blocked', async () => {
        await expectTileBlockedOn(1, 'Service');

        await expectTileLoaded(0);
      });

      await test.step('Satisfying the filter loads the traces tile too', async () => {
        await dashboardPage.toggleFilterValue('Service', 'frontend');

        await expectTileLoaded(1);
      });
    });

    // Being in a broadcast's source scope is not the same as reading it: a
    // PromQL tile is handed no filters, and a raw-SQL tile without the
    // $__filters macro drops them.
    test('does not block a tile that ignores broadcast filters', async () => {
      test.setTimeout(240000);

      const rawSql = `SELECT ServiceName, count() AS count FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) GROUP BY ServiceName LIMIT 200`;

      await test.step('Add a builder tile, a PromQL tile, and a macro-less raw SQL tile', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addNumberTile(
          'Logs count',
          DEFAULT_LOGS_SOURCE_NAME,
        );

        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.switchToPromqlMode();
        await dashboardPage.chartEditor.selectPromqlSource(PROMQL_SOURCE_NAME);
        await dashboardPage.chartEditor.setChartName('PromQL tile');
        await dashboardPage.chartEditor.replacePromqlExpression(
          E2E_PROMQL_METRIC_NAME,
        );
        await dashboardPage.chartEditor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(2, {
          timeout: 10000,
        });

        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.setChartType(DisplayType.Table);
        await dashboardPage.chartEditor.setChartName('Raw SQL tile');
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.typeSqlQuery(rawSql);
        await dashboardPage.chartEditor.runQuery(false);
        await dashboardPage.saveTile();
      });

      await test.step('Add an unscoped required filter', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { required: true },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('Only the builder tile is blocked', async () => {
        await expectTileBlockedOn(0, 'Service');

        await expect(
          dashboardPage.getTileMissingRequiredFilters(1),
        ).toHaveCount(0);
        await expect(
          dashboardPage.getTile(1).locator('.recharts-responsive-container'),
        ).toBeVisible({ timeout: 30000 });

        await expect(
          dashboardPage.getTileMissingRequiredFilters(2),
        ).toHaveCount(0);
        await expect(
          dashboardPage.getTile(2).getByTitle('frontend', { exact: true }),
        ).toBeVisible({ timeout: 30000 });
      });

      await test.step('Satisfying the filter loads the builder tile', async () => {
        await dashboardPage.toggleFilterValue('Service', 'frontend');

        await expectTileLoaded(0);
      });
    });

    // A static-list filter broadcasts nothing, so a variable reference is the
    // only thing that can put a tile in its scope.
    test('blocks only the tiles that reference the variable', async () => {
      test.setTimeout(180000);

      await test.step('Add a scoped requirement and one tile that reads it', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ENVIRONMENTS,
          { variableName: 'env', required: true },
        );
        await dashboardPage.closeFiltersModal();
        await dashboardPage.addNumberTile(
          'Unrelated count',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.addNumberTile(
          'Env count',
          DEFAULT_LOGS_SOURCE_NAME,
          { sqlSeriesWhere: '$__filter(ServiceName, $env)' },
        );
      });

      await test.step('Only the referencing tile is blocked', async () => {
        await expectTileBlockedOn(1, 'Environment');

        await expectTileLoaded(0);
      });

      await test.step('Selecting a value unblocks it', async () => {
        await dashboardPage.toggleFilterValue('Environment', 'prod');

        await expectTileLoaded(1);
      });
    });

    test('flags the unsatisfied filter in the filter bar', async () => {
      test.setTimeout(150000);

      await test.step('Create one required and one optional filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ENVIRONMENTS,
          { variableName: 'env', required: true },
        );
        await dashboardPage.addStaticListFilterToDashboard(
          'Tier',
          ['gold', 'silver'],
          { variableName: 'tier' },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('Only the required filter carries the caution icon', async () => {
        await expect(
          dashboardPage.getFilterRequiredWarning('Environment'),
        ).toBeVisible({ timeout: 20000 });
        await expect(
          dashboardPage.getFilterRequiredWarning('Tier'),
        ).toHaveCount(0);
      });

      await test.step('The icon clears on selection and returns when cleared', async () => {
        await dashboardPage.toggleFilterValue('Environment', 'prod');
        await expect(
          dashboardPage.getFilterRequiredWarning('Environment'),
        ).toHaveCount(0, { timeout: 20000 });

        await dashboardPage.toggleFilterValue('Environment', 'prod');
        await expect(
          dashboardPage.getFilterRequiredWarning('Environment'),
        ).toBeVisible({ timeout: 20000 });
      });
    });

    test('stays blocked until every required filter has a value', async () => {
      test.setTimeout(150000);

      await test.step('Create two required filters over one tile', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ENVIRONMENTS,
          { variableName: 'env', required: true, globalRequirement: true },
        );
        await dashboardPage.addStaticListFilterToDashboard(
          'Tier',
          ['gold', 'silver'],
          { variableName: 'tier', required: true, globalRequirement: true },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('Both are named while neither has a value', async () => {
        await expectTileBlockedOn(0, 'Environment, Tier');
      });

      await test.step('Satisfying one leaves the tile blocked on the other', async () => {
        await dashboardPage.toggleFilterValue('Environment', 'prod');

        await expectTileBlockedOn(0, 'Tier');
        await expect(
          dashboardPage.getTileMissingRequiredFilters(0),
        ).not.toContainText('Environment');
      });

      await test.step('Satisfying the second loads the tile', async () => {
        await dashboardPage.toggleFilterValue('Tier', 'gold');

        await expectTileLoaded(0);
      });
    });

    test('opens unblocked when the selection is saved as the default', async ({
      page,
    }) => {
      test.setTimeout(150000);

      await test.step('Save a selection as the dashboard default', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ENVIRONMENTS,
          { variableName: 'env', required: true, globalRequirement: true },
        );
        await dashboardPage.closeFiltersModal();
        await dashboardPage.toggleFilterValue('Environment', 'prod');
        await dashboardPage.saveQueryAndFiltersAsDefault();
      });

      await test.step('A fresh visit with no filters in the URL is not blocked', async () => {
        const url = new URL(page.url());
        url.search = '';
        await page.goto(url.toString());
        await dashboardPage.waitForLoaded();

        await expect(
          dashboardPage.getFilterPill('Environment', 'prod'),
        ).toBeVisible({ timeout: 20000 });
        await expectTileLoaded(0);
      });
    });

    test('round-trips the required option through an edit', async () => {
      test.setTimeout(150000);

      await test.step('Save a required filter over a tile', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ENVIRONMENTS,
          { variableName: 'env', required: true, globalRequirement: true },
        );
      });

      await test.step('The list marks it required and the edit form reopens checked', async () => {
        await expect(
          dashboardPage.getFilterItemByName('Environment'),
        ).toContainText('Required');

        await dashboardPage.openEditFilterForm('Environment');
        await expect(dashboardPage.requiredFilterCheckbox).toBeChecked();
        await expect(dashboardPage.globalRequirementCheckbox).toBeChecked();
        // The scope only exists under a checked "Required".
        await dashboardPage.requiredFilterCheckbox.uncheck();
        await expect(dashboardPage.globalRequirementCheckbox).toHaveCount(0);
        await dashboardPage.requiredFilterCheckbox.check();
        await dashboardPage.page.getByTestId('save-filter-button').click();
      });

      await test.step('Unchecking it lets the tile load with nothing selected', async () => {
        await dashboardPage.setFilterRequiredForSavedFilter(
          'Environment',
          false,
        );
        await dashboardPage.closeFiltersModal();

        await expectTileLoaded(0);
      });
    });
  },
);
