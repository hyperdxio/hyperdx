/**
 * A dashboard filter marked single-select (`maxSelections: 1`) holds at most one
 * value: picking another value replaces the selection, typing is ignored while
 * a value is selected, and a `filters=` URL param carrying several values keeps
 * only the first.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';
import { expectFiltersParam, gotoWithFilters } from '../utils/filters-param';

const ENVIRONMENTS = ['prod', 'staging', 'dev'];

test.describe(
  'Single-select dashboard filters',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
      await dashboardPage.addNumberTile('Count tile', DEFAULT_LOGS_SOURCE_NAME);
      await dashboardPage.openEditFiltersModal();
      await dashboardPage.addStaticListFilterToDashboard(
        'Environment',
        ENVIRONMENTS,
        { variableName: 'env', singleSelect: true },
      );
      await dashboardPage.closeFiltersModal();
    });

    test('replaces the selection when another value is picked', async ({
      page,
    }) => {
      await dashboardPage.openFilterDropdown('Environment');
      await dashboardPage.getFilterOption('prod').click();
      await expect(
        dashboardPage.getFilterPill('Environment', 'prod'),
      ).toBeVisible();
      await expectFiltersParam(page, [
        { type: 'variable', name: 'env', values: ['prod'] },
      ]);

      await dashboardPage.openFilterDropdown('Environment');
      await dashboardPage.getFilterOption('staging').click();
      await expect(
        dashboardPage.getFilterPill('Environment', 'staging'),
      ).toBeVisible();
      await expect(
        dashboardPage.getFilterPill('Environment', 'prod'),
      ).toHaveCount(0);
      await expectFiltersParam(page, [
        { type: 'variable', name: 'env', values: ['staging'] },
      ]);
    });

    test('ignores typing while a value is selected', async ({ page }) => {
      await dashboardPage.openFilterDropdown('Environment');
      await dashboardPage.getFilterOption('prod').click();
      await expect(
        dashboardPage.getFilterPill('Environment', 'prod'),
      ).toBeVisible();

      await dashboardPage.openFilterDropdown('Environment');
      await expect(
        dashboardPage.getFilterSearchInput('Environment'),
      ).toBeFocused();
      await page.keyboard.type('qa');
      await expect(
        dashboardPage.getFilterSearchInput('Environment'),
      ).toHaveValue('');
      await expect(
        dashboardPage.getFilterPill('Environment', 'prod'),
      ).toBeVisible();
      await expectFiltersParam(page, [
        { type: 'variable', name: 'env', values: ['prod'] },
      ]);
    });

    test('keeps only the first of several values in the URL', async ({
      page,
    }) => {
      await gotoWithFilters(page, dashboardPage.getCurrentDashboardId(), [
        { type: 'variable', name: 'env', values: ['dev', 'prod'] },
      ]);
      await dashboardPage.waitForLoaded();

      await expect(
        dashboardPage.getFilterPill('Environment', 'dev'),
      ).toBeVisible();
      await expect(
        dashboardPage.getFilterPill('Environment', 'prod'),
      ).toHaveCount(0);
    });
  },
);
