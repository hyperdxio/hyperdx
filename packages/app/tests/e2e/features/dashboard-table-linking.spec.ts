import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { DashboardPage } from '../page-objects/DashboardPage';
import { SearchPage } from '../page-objects/SearchPage';
import { getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';

test.describe(
  'Dashboard Table Linking',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;
    let searchPage: SearchPage;

    test.beforeEach(async ({ page }) => {
      test.setTimeout(60000);
      dashboardPage = new DashboardPage(page);
      searchPage = new SearchPage(page);
      await dashboardPage.goto();
      await dashboardPage.createNewDashboard();
    });

    /**
     * Add a Table tile grouped by ServiceName on E2E Logs but stop before
     * saving, so the caller can configure the Row Click Action drawer first.
     */
    async function addTableTile(chartName: string) {
      await dashboardPage.addTile();
      await dashboardPage.chartEditor.waitForDataToLoad();
      await dashboardPage.chartEditor.setChartType(DisplayType.Table);
      await dashboardPage.chartEditor.setChartName(chartName);
      await dashboardPage.chartEditor.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      await dashboardPage.chartEditor.setGroupBy('ServiceName');
    }

    test('Search mode: valid link navigates to /search with rendered SQL WHERE', async ({
      page,
    }) => {
      const ts = Date.now();
      const logSources = await getSources(page, 'log');
      const logsSource = logSources.find(
        (s: { name: string }) => s.name === DEFAULT_LOGS_SOURCE_NAME,
      );
      expect(logsSource).toBeDefined();
      const logsSourceId: string = logsSource.id;

      await test.step('Configure Search-mode row click with SQL WHERE template', async () => {
        await addTableTile(`E2E Table Link ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Search');
        await dashboardPage.chartEditor.fillRowClickSourceTemplate(
          DEFAULT_LOGS_SOURCE_NAME,
        );
        // emptySearchOnClick() defaults whereLanguage to 'sql', but be explicit.
        await dashboardPage.chartEditor.setRowClickWhereLanguage('SQL');
        await dashboardPage.chartEditor.fillRowClickWhereTemplate(
          "ServiceName = '{{ServiceName}}'",
          'sql',
        );
        await dashboardPage.chartEditor.applyRowClickDrawer();
        await dashboardPage.saveTile();
      });

      await test.step('Set dashboard time range to Last 6 hours', async () => {
        await dashboardPage.timePicker.selectRelativeTime('Last 6 hours');
      });

      await dashboardPage.waitForTableTileRows(0);
      // ServiceName is the second column in the rendered table (count is col 0).
      const serviceName = await dashboardPage.getFirstTableRowValue(0, 1);
      expect(serviceName.length).toBeGreaterThan(0);

      await test.step('Click first table row', async () => {
        await dashboardPage.clickFirstTableRow(0);
      });

      await test.step('Verify /search URL has rendered SQL where, source, time range', async () => {
        await expect(page).toHaveURL(/\/search\?/, { timeout: 10000 });
        const url = new URL(page.url());
        expect(url.searchParams.get('source')).toBe(logsSourceId);
        expect(url.searchParams.get('whereLanguage')).toBe('sql');
        expect(url.searchParams.get('isLive')).toBe('false');
        expect(url.searchParams.get('where')).toBe(
          `ServiceName = '${serviceName}'`,
        );
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        expect(from).toBeGreaterThan(0);
        expect(to).toBeGreaterThan(from);
        // "Last 6 hours" range should span ~6h ± a small buffer.
        const sixHoursMs = 6 * 60 * 60 * 1000;
        expect(to - from).toBeGreaterThan(sixHoursMs - 60_000);
        expect(to - from).toBeLessThan(sixHoursMs + 60_000);
      });

      await test.step('Verify search page reflects the selected source', async () => {
        await expect(searchPage.currentSource).toHaveValue(
          DEFAULT_LOGS_SOURCE_NAME,
          { timeout: 10000 },
        );
      });

      await test.step('Verify no Link error notification appeared', async () => {
        await expect(dashboardPage.getLinkErrorNotification()).toBeHidden();
      });
    });

    test('Search mode: unknown source name template shows Link error notification', async ({
      page,
    }) => {
      const ts = Date.now();

      await test.step('Configure Search-mode row click with an unresolvable source', async () => {
        await addTableTile(`E2E Bad Source ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Search');
        await dashboardPage.chartEditor.fillRowClickSourceTemplate(
          'Nonexistent Source {{ServiceName}}',
        );
        await dashboardPage.chartEditor.applyRowClickDrawer();
        await dashboardPage.saveTile();
      });

      await dashboardPage.waitForTableTileRows(0);

      await test.step('Click first row and verify Link error appears', async () => {
        const dashboardUrlBefore = page.url();
        await dashboardPage.clickFirstTableRow(0);
        const notification = dashboardPage.getLinkErrorNotification();
        await expect(notification).toBeVisible({ timeout: 5000 });
        await expect(notification).toContainText(/Could not find source/);
        // Should not have navigated to /search.
        expect(page.url()).toBe(dashboardUrlBefore);
      });
    });

    test('Search mode: WHERE template referencing unknown column shows Link error', async ({
      page,
    }) => {
      const ts = Date.now();

      await test.step('Configure Search-mode row click with bad WHERE column reference', async () => {
        await addTableTile(`E2E Bad Column ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Search');
        await dashboardPage.chartEditor.fillRowClickSourceTemplate(
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.chartEditor.setRowClickWhereLanguage('SQL');
        await dashboardPage.chartEditor.fillRowClickWhereTemplate(
          "NonexistentColumn = '{{NonexistentColumn}}'",
          'sql',
        );
        await dashboardPage.chartEditor.applyRowClickDrawer();
        await dashboardPage.saveTile();
      });

      await dashboardPage.waitForTableTileRows(0);

      await test.step('Click first row and verify Link error appears', async () => {
        const dashboardUrlBefore = page.url();
        await dashboardPage.clickFirstTableRow(0);
        const notification = dashboardPage.getLinkErrorNotification();
        await expect(notification).toBeVisible({ timeout: 5000 });
        await expect(notification).toContainText(
          /Row has no column 'NonexistentColumn'/,
        );
        expect(page.url()).toBe(dashboardUrlBefore);
      });
    });

    test('Default mode: row click filters search by the row group-by value', async ({
      page,
    }) => {
      const ts = Date.now();
      const logSources = await getSources(page, 'log');
      const logsSource = logSources.find(
        (s: { name: string }) => s.name === DEFAULT_LOGS_SOURCE_NAME,
      );
      expect(logsSource).toBeDefined();
      const logsSourceId: string = logsSource.id;

      await test.step('Create Table tile with default row click action', async () => {
        await addTableTile(`E2E Default Link ${ts}`);
        // Don't open the drawer — leave the default OnClick.
        await dashboardPage.saveTile();
      });

      await test.step('Set dashboard time range to Last 6 hours', async () => {
        await dashboardPage.timePicker.selectRelativeTime('Last 6 hours');
      });

      await dashboardPage.waitForTableTileRows(0);
      // ServiceName is the second column in the rendered table (count is col 0).
      const serviceName = await dashboardPage.getFirstTableRowValue(0, 1);
      expect(serviceName.length).toBeGreaterThan(0);

      await test.step('Click first table row', async () => {
        await dashboardPage.clickFirstTableRow(0);
      });

      await test.step('Verify /search URL has source, time range, and group filter', async () => {
        await expect(page).toHaveURL(/\/search\?/, { timeout: 10000 });
        const url = new URL(page.url());
        expect(url.searchParams.get('source')).toBe(logsSourceId);
        expect(url.searchParams.get('isLive')).toBe('false');
        // Default row click encodes the group-by filter as a SQL IN clause in
        // the JSON-encoded `filters` param.
        const filters = url.searchParams.get('filters') ?? '[]';
        expect(filters).toContain(`ServiceName IN ('${serviceName}')`);
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        expect(from).toBeGreaterThan(0);
        expect(to).toBeGreaterThan(from);
      });

      await test.step('Verify search page shows E2E Logs source', async () => {
        await expect(searchPage.currentSource).toHaveValue(
          DEFAULT_LOGS_SOURCE_NAME,
          { timeout: 10000 },
        );
      });

      await test.step('Verify no Link error notification appeared', async () => {
        await expect(dashboardPage.getLinkErrorNotification()).toBeHidden();
      });
    });
  },
);
