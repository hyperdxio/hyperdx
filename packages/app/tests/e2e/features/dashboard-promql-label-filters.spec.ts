/**
 * A `PROMETHEUS_LABEL` dashboard filter fills its dropdown with the values of
 * one Prometheus label, read from a PromQL source and scoped to the dashboard's
 * time range. Like `STATIC_LIST` it carries no SQL expression, so it is a
 * dashboard variable and nothing else.
 *
 * Values come from `E2E_PROMQL_TABLE`, seeded with one `service`-labelled series
 * per entry in `SERVICES` (see seed-clickhouse.ts).
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import type { Page } from '@playwright/test';

import { DashboardPage } from '../page-objects/DashboardPage';
import { SERVICES } from '../seed-clickhouse';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  E2E_PROMQL_METRIC_NAME,
  PROMQL_SOURCE_NAME,
} from '../utils/constants';

/** The dropdown sorts, so the seeded services arrive in this order. */
const SORTED_SERVICES = [...SERVICES].sort((a, b) => a.localeCompare(b));

type FilterEntry =
  | { type: 'sql'; condition: string }
  | { type: 'variable'; name: string; values: string[] };

/** The `filters=` param, decoded. `null` when the param is absent. */
const filtersParam = (page: Page): FilterEntry[] | null => {
  const raw = new URL(page.url()).searchParams.get('filters');
  if (raw === null) return null;
  return JSON.parse(decodeURIComponent(raw));
};

/** Wait for the param to settle on `expected` — nuqs writes it asynchronously. */
const expectFiltersParam = async (page: Page, expected: FilterEntry[]) => {
  await expect(async () => {
    expect(filtersParam(page)).toEqual(expected);
  }).toPass({ timeout: 10000 });
};

test.describe(
  'PromQL label dashboard filters',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

    test('authors a filter with a source and label, and no expression or broadcast controls', async () => {
      test.setTimeout(90000);

      await test.step('Open the add-filter form and pick the PromQL type', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openAddFilterForm();
        await expect(dashboardPage.getFilterTypePicker()).toBeVisible();
        // Filled before the switch: the display name belongs to every type, so
        // changing type must not discard it.
        await dashboardPage.getFilterNameInput().fill('Service');
        await dashboardPage.selectFilterType('PromQL label values');
        await expect(dashboardPage.getFilterNameInput()).toHaveValue('Service');
      });

      await test.step('Only the fields a PromQL label filter has are rendered', async () => {
        const form = dashboardPage.getFilterForm();
        await expect(dashboardPage.getFilterLabelInput()).toBeVisible();
        await expect(form.getByTestId('source-selector')).toBeVisible();
        // Always a variable, so the name is asked for rather than unlocked by
        // a checkbox.
        await expect(dashboardPage.variableNameInput).toBeVisible();

        await expect(dashboardPage.getFilterOptionsInput()).toHaveCount(0);
        await expect(
          form.getByTestId('applies-to-source-selector'),
        ).toHaveCount(0);
        await expect(form.getByTestId('filter-broadcast-checkbox')).toHaveCount(
          0,
        );
        await expect(
          form.getByTestId('filter-variable-enabled-checkbox'),
        ).toHaveCount(0);
        // The series selector is the form's only CodeMirror editor: neither the
        // filter expression nor the dropdown values filter belongs to this type.
        await expect(form.locator('div.cm-editor')).toHaveCount(1);
      });

      await test.step('Only PromQL sources are offered', async () => {
        await dashboardPage.filtersSourceSelector.click();
        await expect(
          dashboardPage.getFilterOption(PROMQL_SOURCE_NAME),
        ).toBeVisible();
        await expect(
          dashboardPage.getFilterOption(DEFAULT_LOGS_SOURCE_NAME),
        ).toHaveCount(0);
        await dashboardPage.getFilterOption(PROMQL_SOURCE_NAME).click();
      });

      await test.step('The label field suggests the label names the source carries', async () => {
        await dashboardPage.getFilterLabelInput().click();
        const suggestion = (name: string) =>
          dashboardPage.page.getByRole('option', { name, exact: true });
        await expect(suggestion('service')).toBeVisible({ timeout: 20000 });
        await expect(suggestion('__name__')).toBeVisible();
        await suggestion('service').click();
        await expect(dashboardPage.getFilterLabelInput()).toHaveValue(
          'service',
        );
      });

      await test.step('The saved filter is summarized by its source and label', async () => {
        await dashboardPage.variableNameInput.fill('svc');
        await dashboardPage.page.getByTestId('save-filter-button').click();

        const item = dashboardPage.getFilterItemByName('Service');
        await expect(item).toBeVisible();
        await expect(item).toContainText(`${PROMQL_SOURCE_NAME} · service`);
        await expect(item).toContainText('($svc)');
      });
    });

    test('lists the label values and stores the selection by variable name', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await test.step('Create a PromQL Service filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addPromqlLabelFilterToDashboard(
          'Service',
          PROMQL_SOURCE_NAME,
          'service',
          { variableName: 'svc' },
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('The dropdown offers every seeded service', async () => {
        await dashboardPage.openFilterDropdown('Service');
        await expect(async () => {
          expect(await dashboardPage.getOpenFilterDropdownOptions()).toEqual(
            SORTED_SERVICES,
          );
        }).toPass({ timeout: 20000 });
        await page.keyboard.press('Escape');
      });

      await test.step('Selecting a value writes a variable-keyed entry', async () => {
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await expectFiltersParam(page, [
          { type: 'variable', name: 'svc', values: ['accounting'] },
        ]);
      });

      await test.step('The selection survives a reload', async () => {
        await page.reload();
        await dashboardPage.waitForLoaded();
        await expect(
          dashboardPage.getFilterPill('Service', 'accounting'),
        ).toBeVisible({ timeout: 20000 });
      });
    });

    test('lists metric names when the label is __name__', async ({ page }) => {
      test.setTimeout(90000);

      await dashboardPage.createNewDashboard();
      await dashboardPage.openEditFiltersModal();
      await dashboardPage.addPromqlLabelFilterToDashboard(
        'Metric',
        PROMQL_SOURCE_NAME,
        '__name__',
        { variableName: 'metric' },
      );
      await dashboardPage.closeFiltersModal();

      await dashboardPage.openFilterDropdown('Metric');
      await expect(async () => {
        expect(await dashboardPage.getOpenFilterDropdownOptions()).toContain(
          E2E_PROMQL_METRIC_NAME,
        );
      }).toPass({ timeout: 20000 });
      await page.keyboard.press('Escape');
    });

    test('narrows a raw SQL tile by the selected value', async () => {
      test.setTimeout(120000);
      const chartName = `E2E PromQL Filter Tile ${Date.now()}`;
      // The seeded `service` label values are the same strings the logs carry
      // as ServiceName, so a selection here narrows a query over the logs table.
      const sql = `SELECT ServiceName, count() AS count FROM default.e2e_otel_logs WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp <= fromUnixTimestamp64Milli({endDateMilliseconds:Int64}) AND $__conditionalAll(ServiceName IN $svc, $svc) GROUP BY ServiceName LIMIT 200`;

      await test.step('Create a PromQL Service filter and select one value', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addPromqlLabelFilterToDashboard(
          'Service',
          PROMQL_SOURCE_NAME,
          'service',
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

    test('narrows the dropdown to the series the selector matches', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await dashboardPage.createNewDashboard();
      await dashboardPage.openEditFiltersModal();
      await dashboardPage.addPromqlLabelFilterToDashboard(
        'Service',
        PROMQL_SOURCE_NAME,
        'service',
        {
          variableName: 'svc',
          match: `${E2E_PROMQL_METRIC_NAME}{service="${SORTED_SERVICES[0]}"}`,
        },
      );
      await dashboardPage.closeFiltersModal();

      await dashboardPage.openFilterDropdown('Service');
      await expect(async () => {
        expect(await dashboardPage.getOpenFilterDropdownOptions()).toEqual([
          SORTED_SERVICES[0],
        ]);
      }).toPass({ timeout: 20000 });
      await page.keyboard.press('Escape');
    });

    test("authors a selector that references another filter's variable", async ({
      page,
    }) => {
      test.setTimeout(120000);

      await test.step('Declare an Environment variable for the selector to reference', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addStaticListFilterToDashboard(
          'Environment',
          ['prod', 'staging'],
          { variableName: 'env' },
        );
      });

      await test.step("The selector completes the other filter's variable", async () => {
        await dashboardPage.openAddFilterForm();
        await dashboardPage.selectFilterType('PromQL label values');
        await dashboardPage.getFilterNameInput().fill('Pod');
        await dashboardPage.selectFilterSource(PROMQL_SOURCE_NAME);
        await dashboardPage.getFilterLabelInput().fill('pod');
        // The closing `"` and `}` are auto-inserted, and the completion's
        // replace range reaches over them.
        await dashboardPage.fillFilterMatch('up{job=~"$en');
        await dashboardPage.acceptFilterMatchCompletion('$env');
        expect(await dashboardPage.getFilterMatchText()).toBe(
          'up{job=~"$env"}',
        );
      });

      await test.step('The selector survives a save and a reload', async () => {
        await dashboardPage.variableNameInput.fill('pod');
        await page.getByTestId('save-filter-button').click();
        await expect(dashboardPage.getFilterItemByName('Pod')).toBeVisible();
        await dashboardPage.closeFiltersModal();

        await page.reload();
        await dashboardPage.waitForLoaded();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openEditFilterForm('Pod');
        expect(await dashboardPage.getFilterMatchText()).toBe(
          'up{job=~"$env"}',
        );
      });

      // Honoring it would narrow the dropdown to the values already selected
      // in it, so the reference is never offered in the first place.
      await test.step('The filter cannot reference its own variable', async () => {
        await dashboardPage.fillFilterMatch('{job=~"$');
        const options = dashboardPage.filterMatchCompletionOptions();
        await expect(options.filter({ hasText: '$env' })).not.toHaveCount(0);
        await expect(options.filter({ hasText: '$pod' })).toHaveCount(0);
      });
    });

    test('round-trips the source and label through an edit', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await test.step('Create a PromQL Service filter', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addPromqlLabelFilterToDashboard(
          'Service',
          PROMQL_SOURCE_NAME,
          'service',
          { variableName: 'svc' },
        );
      });

      await test.step('Reopening the form shows what was saved', async () => {
        await dashboardPage.openEditFilterForm('Service');
        await expect(dashboardPage.getFilterLabelInput()).toHaveValue(
          'service',
        );
        await expect(dashboardPage.filtersSourceSelector).toHaveValue(
          PROMQL_SOURCE_NAME,
        );
        await expect(dashboardPage.variableNameInput).toHaveValue('svc');
      });

      await test.step('A changed label is saved and survives a reload', async () => {
        await dashboardPage.getFilterLabelInput().fill('__name__');
        await page.getByTestId('save-filter-button').click();
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toContainText(`${PROMQL_SOURCE_NAME} · __name__`);
        await dashboardPage.closeFiltersModal();

        await page.reload();
        await dashboardPage.waitForLoaded();
        await dashboardPage.openFilterDropdown('Service');
        await expect(async () => {
          expect(await dashboardPage.getOpenFilterDropdownOptions()).toContain(
            E2E_PROMQL_METRIC_NAME,
          );
        }).toPass({ timeout: 20000 });
      });
    });
  },
);
