/**
 * Dashboard filter selections are persisted in the `filters=` URL param (and in
 * `savedFilterValues`) in one of two shapes:
 *
 *   legacy, keyed by SQL expression: { type: 'sql', condition: "E IN ('a')" }
 *   variable-keyed:                  { type: 'variable', name: 'svc', values: ['a'] }
 *
 * A variable-enabled filter reads both and writes the variable-keyed form. These
 * tests pin the round trip through the real URL and the real ClickHouse query:
 * back-compat on read, migration on write, independence of two filters that
 * share an expression, and verbatim escaping.
 *
 * Every test is `@full-stack`: the variables flag is only set on the full-stack
 * webServer (see playwright.config.ts).
 */
import type { Page } from '@playwright/test';

import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';
import { expectFiltersParam, type FilterEntry } from '../utils/filters-param';

/** Navigate to a dashboard with a hand-written `filters=` param. */
const gotoWithFilters = async (
  page: Page,
  dashboardId: string,
  entries: FilterEntry[],
) => {
  await page.goto(
    `/dashboards/${dashboardId}?filters=${encodeURIComponent(
      JSON.stringify(entries),
    )}`,
  );
};

/** Assert exactly `values` are selected in `filterName`'s multi-select. */
const expectSelected = async (
  dashboardPage: DashboardPage,
  filterName: string,
  values: string[],
) => {
  for (const value of values) {
    await expect(dashboardPage.getFilterPill(filterName, value)).toBeVisible({
      timeout: 20000,
    });
  }
};

test.describe(
  'Dashboard filter value format',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.timePicker.selectRelativeTime('Last 1 hour');
    });

    test('reads a legacy sql entry for a variable-enabled filter and migrates it on the next write', async ({
      page,
    }) => {
      test.setTimeout(120000);
      let dashboardId = '';

      await test.step('Create a dashboard with a variable-enabled Service filter', async () => {
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        dashboardId = dashboardPage.getCurrentDashboardId();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { variableName: 'svc' },
        );
        // The list must show the filter before the next add: the modal
        // writes the dashboard optimistically, so a racing add drops one.
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();
        await dashboardPage.closeFiltersModal();
      });

      await test.step('An old-format link still applies, with no banner', async () => {
        await gotoWithFilters(page, dashboardId, [
          { type: 'sql', condition: "ServiceName IN ('accounting')" },
        ]);
        await dashboardPage.waitForLoaded();

        await expectSelected(dashboardPage, 'Service', ['accounting']);
        await expect(dashboardPage.ignoredUrlFiltersBanner).toBeHidden();
        await expect(dashboardPage.getTileError()).toHaveCount(0);
      });

      await test.step('Adding a second value rewrites the param in the variable format', async () => {
        await dashboardPage.toggleFilterValue('Service', 'frontend');

        await expectFiltersParam(page, [
          { type: 'variable', name: 'svc', values: ['accounting', 'frontend'] },
        ]);
      });

      await test.step('Both values survive a reload', async () => {
        await page.reload();
        await dashboardPage.waitForLoaded();

        await expectSelected(dashboardPage, 'Service', [
          'accounting',
          'frontend',
        ]);
        await expect(dashboardPage.getTileError()).toHaveCount(0);
      });
    });

    test('keeps two filters on one expression independent', async ({
      page,
    }) => {
      test.setTimeout(120000);

      await test.step('Declare a variable-enabled and a plain filter on ServiceName', async () => {
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service A',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { variableName: 'svcA' },
        );
        // The list must show the filter before the next add: the modal
        // writes the dashboard optimistically, so a racing add drops one.
        await expect(
          dashboardPage.getFilterItemByName('Service A'),
        ).toBeVisible();
        await dashboardPage.addFilterToDashboard(
          'Service B',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { isVariableEnabled: false },
        );
        // The list must show the filter before the next add: the modal
        // writes the dashboard optimistically, so a racing add drops one.
        await expect(
          dashboardPage.getFilterItemByName('Service B'),
        ).toBeVisible();
        await dashboardPage.closeFiltersModal();
      });

      await test.step('Each dropdown holds only its own selection', async () => {
        await dashboardPage.toggleFilterValue('Service A', 'accounting');
        await dashboardPage.toggleFilterValue('Service B', 'frontend');

        await expectSelected(dashboardPage, 'Service A', ['accounting']);
        await expectSelected(dashboardPage, 'Service B', ['frontend']);
        // Neither dropdown picked up the other's value.
        await expect(
          dashboardPage.getFilterPill('Service A', 'frontend'),
        ).toHaveCount(0);
        await expect(
          dashboardPage.getFilterPill('Service B', 'accounting'),
        ).toHaveCount(0);
      });

      await test.step('The URL carries one variable entry and one sql entry', async () => {
        await expectFiltersParam(page, [
          { type: 'sql', condition: "ServiceName IN ('frontend')" },
          { type: 'variable', name: 'svcA', values: ['accounting'] },
        ]);
      });

      await test.step('Both survive a reload independently', async () => {
        await page.reload();
        await dashboardPage.waitForLoaded();

        await expectSelected(dashboardPage, 'Service A', ['accounting']);
        await expectSelected(dashboardPage, 'Service B', ['frontend']);
        await expect(
          dashboardPage.getFilterPill('Service A', 'frontend'),
        ).toHaveCount(0);
      });
    });

    test('warns about an orphaned variable name and preserves it', async ({
      page,
    }) => {
      test.setTimeout(120000);
      let dashboardId = '';

      await test.step('Create a dashboard with a variable-enabled Service filter', async () => {
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        dashboardId = dashboardPage.getCurrentDashboardId();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { variableName: 'svc' },
        );
        // The list must show the filter before the next add: the modal
        // writes the dashboard optimistically, so a racing add drops one.
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();
        await dashboardPage.closeFiltersModal();
      });

      await test.step('An entry naming no declared variable raises the banner', async () => {
        await gotoWithFilters(page, dashboardId, [
          { type: 'variable', name: 'nope', values: ['x'] },
          { type: 'variable', name: 'svc', values: ['accounting'] },
        ]);
        await dashboardPage.waitForLoaded();

        await expect(dashboardPage.ignoredUrlFiltersBanner).toBeVisible({
          timeout: 20000,
        });
        await expect(dashboardPage.ignoredUrlFiltersBanner).toContainText(
          '$nope',
        );
        await expect(dashboardPage.ignoredUrlFiltersBanner).not.toContainText(
          '$svc',
        );
        // The declared variable still applied.
        await expectSelected(dashboardPage, 'Service', ['accounting']);
      });

      await test.step('The orphan survives a write to another filter', async () => {
        await dashboardPage.toggleFilterValue('Service', 'frontend');

        await expectFiltersParam(page, [
          { type: 'variable', name: 'svc', values: ['accounting', 'frontend'] },
          { type: 'variable', name: 'nope', values: ['x'] },
        ]);
      });
    });

    test('carries values verbatim through the variable-keyed format', async ({
      page,
    }) => {
      test.setTimeout(120000);
      let dashboardId = '';
      // None of these match seeded data — the point is that they survive the
      // round trip unmangled and produce a valid query, not that they match.
      const awkwardValues = ["a'b\\c,d)e", 'true', 'toString(x)'];

      await test.step('Create a variable-enabled Service filter and a plain Severity filter', async () => {
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        dashboardId = dashboardPage.getCurrentDashboardId();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { variableName: 'svc' },
        );
        // The list must show the filter before the next add: the modal
        // writes the dashboard optimistically, so a racing add drops one.
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();
        await dashboardPage.addFilterToDashboard(
          'Severity',
          DEFAULT_LOGS_SOURCE_NAME,
          'SeverityText',
          undefined,
          undefined,
          { isVariableEnabled: false },
        );
        // The list must show the filter before the next add: the modal
        // writes the dashboard optimistically, so a racing add drops one.
        await expect(
          dashboardPage.getFilterItemByName('Severity'),
        ).toBeVisible();
        await dashboardPage.closeFiltersModal();
      });

      await test.step('The values render verbatim as chips and the tile still queries', async () => {
        await gotoWithFilters(page, dashboardId, [
          { type: 'variable', name: 'svc', values: awkwardValues },
        ]);
        await dashboardPage.waitForLoaded();

        await expectSelected(dashboardPage, 'Service', awkwardValues);
        await expect(dashboardPage.getTileError()).toHaveCount(0);
      });

      await test.step('They are byte-identical after touching another filter', async () => {
        await dashboardPage.toggleFilterValue('Severity', 'error');

        await expectFiltersParam(page, [
          { type: 'sql', condition: "SeverityText IN ('error')" },
          { type: 'variable', name: 'svc', values: awkwardValues },
        ]);
        await expect(dashboardPage.getTileError()).toHaveCount(0);
      });
    });

    test('restores a variable-keyed selection from the dashboard default', async ({
      page,
    }) => {
      test.setTimeout(120000);
      let dashboardId = '';

      await test.step('Create a variable-enabled Service filter and select a value', async () => {
        await dashboardPage.addNumberTile(
          'Count tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
        dashboardId = dashboardPage.getCurrentDashboardId();
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
          undefined,
          undefined,
          { variableName: 'svc' },
        );
        // The list must show the filter before the next add: the modal
        // writes the dashboard optimistically, so a racing add drops one.
        await expect(
          dashboardPage.getFilterItemByName('Service'),
        ).toBeVisible();
        await dashboardPage.closeFiltersModal();
        await dashboardPage.toggleFilterValue('Service', 'accounting');
        await expectFiltersParam(page, [
          { type: 'variable', name: 'svc', values: ['accounting'] },
        ]);
      });

      await test.step('Save it as the dashboard default', async () => {
        await dashboardPage.saveQueryAndFiltersAsDefault();
      });

      await test.step('Opening the dashboard with no params restores it', async () => {
        await dashboardPage.gotoDashboard(dashboardId);
        await dashboardPage.waitForLoaded();

        await expectSelected(dashboardPage, 'Service', ['accounting']);
        await expect(dashboardPage.ignoredUrlFiltersBanner).toBeHidden();
      });
    });
  },
);
