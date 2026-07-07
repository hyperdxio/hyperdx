/**
 * Filter key edge cases
 *
 * Exercises identifier escaping for "interesting" filter keys across two
 * sources, each seeded with 3 rows whose per-column values are distinct so a
 * single filter value matches exactly one row.
 *
 * 1. `otel_logs_interesting_filter_keys` (INTERESTING_FILTER_KEYS_SOURCE_NAME)
 *    — facet keys/values come straight from the base table. Covers:
 *      - ServiceName                              — plain LowCardinality column
 *      - ResourceAttributes['key.subKey.subSubKey'] — Map access with a dotted key
 *      - ResourceAttributesJSON.key.subKey.subSubKey — JSON nested path (dashboard)
 *      - `__hdx_materialized_k8s.cluster.name`    — column whose NAME contains dots
 *      - `service-name`                           — column whose name has a hyphen
 *      - `Map-Attributes`['pod-name']             — Map column whose NAME has a hyphen
 *      - `JSON-Attributes`.`key-1`.`key-2`        — JSON column whose name AND nested
 *                                                   keys have hyphens (dashboard only)
 *
 * 2. `e2e_otel_logs_metadata_mv` (METADATA_MV_LOGS_SOURCE_NAME) — a plain
 *    otel_logs-schema table whose facet keys/values are served from metadata
 *    materialized views (15-minute key + key/value rollups) registered on the
 *    source definition. Reruns the filter checks against the rollup-backed facet
 *    path for:
 *      - ServiceName                  — native column (ColumnIdentifier=NativeColumn)
 *      - LogAttributes['requestId']   — Map key (ColumnIdentifier=LogAttributes)
 *
 * JSON columns are tested on the dashboard only: JSON nested-path facets are
 * disabled on the search page (HDX-2480), so they don't surface in the sidebar.
 *
 * Search tests verify the sidebar facets resolve and include/exclude correctly.
 * Dashboard tests verify a Number tile (count) filters to 1 / back to 3, both
 * when the column expression is typed raw and when it is pre-quoted with
 * backticks (the app must not double-escape an already-quoted identifier).
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { SearchPage } from '../page-objects/SearchPage';
import {
  INTERESTING_FILTER_KEYS_ROWS,
  METADATA_MV_LOG_ATTR_KEY,
  METADATA_MV_ROWS,
} from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import {
  INTERESTING_FILTER_KEYS_SOURCE_NAME,
  METADATA_MV_LOGS_SOURCE_NAME,
} from '../utils/constants';

const [ROW1, ROW2, ROW3] = INTERESTING_FILTER_KEYS_ROWS;
const [MV_ROW1, MV_ROW2, MV_ROW3] = METADATA_MV_ROWS;

// Re-running a ClickHouse query after a filter change (and the table/tile
// re-render) can take noticeably longer than Playwright's 5s assertion default
// on slow CI runners. Give count/value assertions extra headroom.
const QUERY_TIMEOUT = 20_000;

// Each search column: the chain of sidebar group test ids to expand (a single
// `filter-group-*` for top-level columns, or the nested chain for Map keys and
// dotted column names), the leaf column name used in the value checkbox test id,
// and the three seeded values (index 0 corresponds to the source's first row).
type SearchColumn = {
  label: string;
  groupTestids: string[];
  column: string;
  values: readonly [string, string, string];
};

// Each dashboard column: a unique filter name, the raw and/or backtick-quoted
// forms of the column expression, and the value (from the first row) that should
// reduce the count to 1. A form left undefined is skipped for that variant.
type DashboardColumn = {
  name: string;
  raw?: string;
  quoted?: string;
  value: string;
};

type Scenario = {
  source: string;
  // Body of the index-0 row — the single row a values[0] filter matches.
  row1Body: string;
  searchColumns: readonly SearchColumn[];
  dashboardColumns: readonly DashboardColumn[];
};

const SCENARIOS: readonly Scenario[] = [
  {
    source: INTERESTING_FILTER_KEYS_SOURCE_NAME,
    row1Body: ROW1.body,
    searchColumns: [
      {
        label: 'ServiceName',
        groupTestids: ['filter-group-ServiceName'],
        column: 'ServiceName',
        values: [ROW1.serviceName, ROW2.serviceName, ROW3.serviceName],
      },
      {
        label: "ResourceAttributes['key.subKey.subSubKey']",
        groupTestids: [
          'nested-filter-group-ResourceAttributes',
          "nested-filter-group-ResourceAttributes['key.subKey.subSubKey']",
        ],
        column: 'key.subKey.subSubKey',
        values: [
          ROW1.resourceAttrValue,
          ROW2.resourceAttrValue,
          ROW3.resourceAttrValue,
        ],
      },
      {
        label: '__hdx_materialized_k8s.cluster.name',
        groupTestids: [
          'nested-filter-group-__hdx_materialized_k8s',
          'nested-filter-group-__hdx_materialized_k8s.cluster.name',
        ],
        column: 'cluster.name',
        values: [ROW1.clusterName, ROW2.clusterName, ROW3.clusterName],
      },
      {
        label: 'service-name',
        groupTestids: ['filter-group-service-name'],
        column: 'service-name',
        values: [
          ROW1.serviceNameHyphen,
          ROW2.serviceNameHyphen,
          ROW3.serviceNameHyphen,
        ],
      },
      {
        label: "Map-Attributes['pod-name']",
        groupTestids: [
          'nested-filter-group-Map-Attributes',
          "nested-filter-group-Map-Attributes['pod-name']",
        ],
        column: 'pod-name',
        values: [ROW1.mapHyphenValue, ROW2.mapHyphenValue, ROW3.mapHyphenValue],
      },
      // NOTE: A JSON column (e.g. `JSON-Attributes`) is intentionally NOT covered
      // here — JSON nested-path facets are disabled on the search page (HDX-2480:
      // getAllFields skips JSON columns), so they never surface in the sidebar. The
      // JSON hyphen-name + hyphen-key case is exercised on the dashboard instead
      // (see JsonHyphenFilter below).
    ],
    dashboardColumns: [
      {
        name: 'ServiceNameFilter',
        raw: 'ServiceName',
        quoted: '`ServiceName`',
        value: ROW1.serviceName,
      },
      {
        name: 'MapKeyFilter',
        raw: "ResourceAttributes['key.subKey.subSubKey']",
        quoted: "`ResourceAttributes`['key.subKey.subSubKey']",
        value: ROW1.resourceAttrValue,
      },
      {
        name: 'JsonPathFilter',
        raw: 'ResourceAttributesJSON.key.subKey.subSubKey',
        quoted: '`ResourceAttributesJSON`.`key`.`subKey`.`subSubKey`',
        value: ROW1.jsonValue,
      },
      {
        name: 'ClusterFilter',
        // A flat column whose name contains dots is ambiguous verbatim (ClickHouse
        // parses `a.b.c` as nested access), so the raw form is expected to fail —
        // dashboard expressions are never auto-quoted. Only the explicitly-quoted
        // form works. (Search differs: the facet UI owns the key, so it is quoted
        // schema-awarely there.)
        raw: undefined,
        quoted: '`__hdx_materialized_k8s.cluster.name`',
        value: ROW1.clusterName,
      },
      {
        name: 'ServiceHyphenFilter',
        raw: undefined, // raw is expected to fail - it will be parsed as subtraction
        quoted: '`service-name`',
        value: ROW1.serviceNameHyphen,
      },
      {
        // Verbatim function-call expression. `toString(ServiceName)` resolves to
        // ServiceName values, so the value to select is ROW1.serviceName (not the
        // hyphen column's value).
        name: 'ToStringFilter',
        raw: 'toString(ServiceName)',
        quoted: undefined, // toString() is added in the filter query generation, so there's no user-typed raw form to test against
        value: ROW1.serviceName,
      },
      {
        // Map column whose NAME contains a hyphen. Raw `Map-Attributes['pod-name']`
        // is parsed as subtraction (`Map` - `Attributes`), so the user must quote it.
        name: 'MapHyphenFilter',
        raw: undefined,
        quoted: "`Map-Attributes`['pod-name']",
        value: ROW1.mapHyphenValue,
      },
      {
        // JSON column whose name AND nested keys contain hyphens. Raw form parses
        // incorrectly, so the user must backtick-quote each segment.
        name: 'JsonHyphenFilter',
        raw: undefined,
        quoted: '`JSON-Attributes`.`key-1`.`key-2`',
        value: ROW1.jsonHyphenValue,
      },
    ],
  },
  {
    // Source whose facet keys/values are served by metadata materialized views.
    // Covers a native column (ServiceName) and a Map key (LogAttributes), both of
    // which the rollup MVs aggregate (ColumnIdentifier = NativeColumn / LogAttributes).
    source: METADATA_MV_LOGS_SOURCE_NAME,
    row1Body: MV_ROW1.body,
    searchColumns: [
      {
        label: 'ServiceName',
        groupTestids: ['filter-group-ServiceName'],
        column: 'ServiceName',
        values: [MV_ROW1.serviceName, MV_ROW2.serviceName, MV_ROW3.serviceName],
      },
      {
        label: `LogAttributes['${METADATA_MV_LOG_ATTR_KEY}']`,
        groupTestids: [
          'nested-filter-group-LogAttributes',
          `nested-filter-group-LogAttributes['${METADATA_MV_LOG_ATTR_KEY}']`,
        ],
        column: METADATA_MV_LOG_ATTR_KEY,
        values: [
          MV_ROW1.logAttrValue,
          MV_ROW2.logAttrValue,
          MV_ROW3.logAttrValue,
        ],
      },
    ],
    dashboardColumns: [
      {
        name: 'ServiceNameFilter',
        raw: 'ServiceName',
        quoted: '`ServiceName`',
        value: MV_ROW1.serviceName,
      },
      {
        name: 'LogAttrFilter',
        raw: `LogAttributes['${METADATA_MV_LOG_ATTR_KEY}']`,
        quoted: `\`LogAttributes\`['${METADATA_MV_LOG_ATTR_KEY}']`,
        value: MV_ROW1.logAttrValue,
      },
    ],
  },
];

for (const scenario of SCENARIOS) {
  const SOURCE = scenario.source;

  // -------------------------------------------------------------------------
  // Search page
  // -------------------------------------------------------------------------
  test.describe(
    `Filter key edge cases — Search [${SOURCE}]`,
    { tag: ['@search', '@full-stack'] },
    () => {
      let searchPage: SearchPage;

      test.beforeEach(async ({ page }) => {
        searchPage = new SearchPage(page);
        await searchPage.goto();
        await searchPage.selectSource(SOURCE);
        await searchPage.timePicker.selectRelativeTime('Last 1 hour');
        await searchPage.table.waitForRowsToPopulate();
      });

      for (const col of scenario.searchColumns) {
        // The matching value/row is index 0; row1Body uniquely identifies it.
        const matchValue = col.values[0];

        test(`includes and excludes by ${col.label}`, async () => {
          const rows = searchPage.table.getRows();

          await test.step('filter options show the seeded values', async () => {
            await searchPage.filters.revealColumnValues(
              col.groupTestids,
              col.column,
              matchValue,
            );
            for (const value of col.values) {
              await expect(
                searchPage.filters.getFilterCheckboxInput(col.column, value),
              ).toBeVisible();
            }
          });

          await test.step('value distribution renders when toggled on', async () => {
            // The distribution query uses the column key as a raw SQL
            // SELECT/GROUP BY expression, so a key that needs quoting must be
            // escaped or the query errors and no percentage renders. A visible
            // percentage proves the distribution query ran and returned a value.
            await searchPage.filters.showDistribution(col.column);
            await expect(
              searchPage.filters.getDistributionPercentage(
                col.column,
                matchValue,
              ),
            ).toBeVisible({ timeout: QUERY_TIMEOUT });
            // Toggle back off so later steps start from a clean state.
            await searchPage.filters.showDistribution(col.column);
          });

          await test.step('applying a value shows only the matching row', async () => {
            await searchPage.filters.applyFilter(col.column, matchValue);
            // Confirm the click registered before asserting on results, so a
            // missed click is reported as an unchecked box rather than a stale
            // row count.
            await expect(
              searchPage.filters.getFilterCheckboxInput(col.column, matchValue),
            ).toBeChecked({ timeout: QUERY_TIMEOUT });
            await expect(searchPage.getTableError()).toHaveCount(0);
            await expect(rows).toHaveCount(1, { timeout: QUERY_TIMEOUT });
            await expect(
              rows.filter({ hasText: scenario.row1Body }),
            ).toHaveCount(1);
          });

          await test.step('filter persists across reload', async () => {
            await searchPage.page.reload();
            await expect(searchPage.page).toHaveURL(/filters=/);
            await searchPage.table.waitForRowsToPopulate();
            await expect(searchPage.getTableError()).toHaveCount(0);
            await expect(rows).toHaveCount(1, { timeout: QUERY_TIMEOUT });
            await expect(
              rows.filter({ hasText: scenario.row1Body }),
            ).toHaveCount(1);
          });

          await test.step('excluding the value shows the two other rows', async () => {
            await searchPage.filters.revealColumnValues(
              col.groupTestids,
              col.column,
              matchValue,
            );
            // Move the value straight from included to excluded via the Exclude
            // button. The exclude action clears the include set and adds the
            // exclude in a single click, so there's no need to first uncheck the
            // box (clicking the checkbox to deselect is avoided).
            await searchPage.filters.excludeFilter(col.column, matchValue);
            await expect
              .poll(
                () =>
                  searchPage.filters.isFilterExcluded(col.column, matchValue),
                { timeout: QUERY_TIMEOUT },
              )
              .toBe(true);
            await expect(searchPage.getTableError()).toHaveCount(0);
            await expect(rows).toHaveCount(2, { timeout: QUERY_TIMEOUT });
            await expect(
              rows.filter({ hasText: scenario.row1Body }),
            ).toHaveCount(0);
          });

          await test.step('deselecting the excluded value restores all rows', async () => {
            await searchPage.filters.revealColumnValues(
              col.groupTestids,
              col.column,
              matchValue,
            );
            // Deselect by clicking the Exclude button again (toggles the exclude
            // off), NOT the checkbox — clicking the checkbox of an excluded value
            // re-includes it rather than clearing it.
            await searchPage.filters.excludeFilter(col.column, matchValue);
            await expect
              .poll(
                () =>
                  searchPage.filters.isFilterExcluded(col.column, matchValue),
                { timeout: QUERY_TIMEOUT },
              )
              .toBe(false);
            await expect(
              searchPage.filters.getFilterCheckboxInput(col.column, matchValue),
            ).not.toBeChecked({ timeout: QUERY_TIMEOUT });
            await expect(searchPage.getTableError()).toHaveCount(0);
            await expect(rows).toHaveCount(3, { timeout: QUERY_TIMEOUT });
          });

          // Re-exclude so the persistence step below still verifies a saved
          // exclusion across reload.
          await test.step('re-exclude the value', async () => {
            await searchPage.filters.excludeFilter(col.column, matchValue);
            await expect
              .poll(
                () =>
                  searchPage.filters.isFilterExcluded(col.column, matchValue),
                { timeout: QUERY_TIMEOUT },
              )
              .toBe(true);
            await expect(rows).toHaveCount(2, { timeout: QUERY_TIMEOUT });
          });

          await test.step('exclusion persists across reload', async () => {
            await searchPage.page.reload();
            await expect(searchPage.page).toHaveURL(/filters=/);
            await searchPage.table.waitForRowsToPopulate();
            await expect(searchPage.getTableError()).toHaveCount(0);
            await expect(rows).toHaveCount(2, { timeout: QUERY_TIMEOUT });
            await expect(
              rows.filter({ hasText: scenario.row1Body }),
            ).toHaveCount(0);
          });
        });

        // Isolated from the include/exclude flow above: adding a column injects
        // the key into the search SELECT as a raw SQL expression, so a key that
        // needs quoting must be escaped or the query errors. No table error +
        // all rows still present proves the generated SELECT is valid.
        test(`"Add column" builds a valid query for ${col.label}`, async () => {
          await searchPage.filters.revealColumnValues(
            col.groupTestids,
            col.column,
            matchValue,
          );
          await searchPage.filters.toggleColumn(col.column);
          await searchPage.table.waitForRowsToPopulate();
          await expect(searchPage.getTableError()).toHaveCount(0);
          await expect(searchPage.table.getRows()).toHaveCount(3, {
            timeout: QUERY_TIMEOUT,
          });
        });
      }
    },
  );

  // -------------------------------------------------------------------------
  // Dashboard page
  // -------------------------------------------------------------------------
  test.describe(
    `Filter key edge cases — Dashboard [${SOURCE}]`,
    { tag: ['@dashboard', '@full-stack'] },
    () => {
      // variant = which form of the column expression is typed into the filter
      // edit modal: 'raw' (no manual quoting) or 'quoted' (explicit backticks).
      for (const variant of ['raw', 'quoted'] as const) {
        test(`number tile filters by custom column filters (${variant} column names)`, async ({
          page,
        }) => {
          const dashboardPage = new DashboardPage(page);

          await test.step('create a count Number tile (shows all 3 rows)', async () => {
            await dashboardPage.goto();
            await dashboardPage.createNewDashboard();
            await dashboardPage.timePicker.selectRelativeTime('Last 1 hour');
            await dashboardPage.addNumberTile('Count tile', SOURCE);
            await expect(dashboardPage.getNumberTileValue()).toHaveText('3', {
              timeout: QUERY_TIMEOUT,
            });
          });

          await test.step('add a custom filter for each column', async () => {
            await dashboardPage.openEditFiltersModal();
            for (const col of scenario.dashboardColumns) {
              const expression = variant === 'raw' ? col.raw : col.quoted;
              if (!expression) continue;
              await dashboardPage.addCustomFilter(col.name, SOURCE, expression);
            }
            await dashboardPage.closeFiltersModal();
            // Reload once so the tile + filter definitions are loaded from the
            // server; confirms persistence before the per-filter reload checks.
            await page.reload();
            await dashboardPage.waitForLoaded();
            await expect(dashboardPage.getNumberTileValue()).toHaveText('3', {
              timeout: QUERY_TIMEOUT,
            });
            // Every filter created for this variant must render as a selector.
            // Columns with no expression for the current variant (e.g. raw forms
            // that are invalid verbatim) are skipped above, so skip them here too.
            for (const col of scenario.dashboardColumns) {
              const expression = variant === 'raw' ? col.raw : col.quoted;
              if (!expression) continue;
              await expect(
                dashboardPage.getFilterSelectByName(col.name),
              ).toBeVisible();
            }
          });

          for (const col of scenario.dashboardColumns) {
            const expression = variant === 'raw' ? col.raw : col.quoted;
            if (!expression) continue;

            await test.step(`${col.name}: select → 1, reload → 1, deselect → 3`, async () => {
              await dashboardPage.toggleFilterValue(col.name, col.value);
              await expect(dashboardPage.getNumberTileValue()).toHaveText('1', {
                timeout: QUERY_TIMEOUT,
              });
              await expect(dashboardPage.getTileError()).toHaveCount(0);

              await page.reload();
              await dashboardPage.waitForLoaded();
              await expect(dashboardPage.getNumberTileValue()).toHaveText('1', {
                timeout: QUERY_TIMEOUT,
              });
              await expect(dashboardPage.getTileError()).toHaveCount(0);

              await dashboardPage.toggleFilterValue(col.name, col.value);
              await expect(dashboardPage.getNumberTileValue()).toHaveText('3', {
                timeout: QUERY_TIMEOUT,
              });
              await expect(dashboardPage.getTileError()).toHaveCount(0);
            });
          }
        });
      }
    },
  );
}
