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
        await dashboardPage.chartEditor.fillRowClickTemplate(
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
        await dashboardPage.chartEditor.fillRowClickTemplate(
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
        await dashboardPage.chartEditor.fillRowClickTemplate(
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

    test('Dashboard mode: valid link navigates to target dashboard with rendered WHERE', async ({
      page,
    }) => {
      const ts = Date.now();
      const targetDashboardName = `E2E Target Dashboard ${ts}`;
      let targetDashboardId = '';

      await test.step('Create the target dashboard (must exist before opening drawer)', async () => {
        // beforeEach already created a dashboard; replace it with the target.
        await dashboardPage.editDashboardName(targetDashboardName);
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart(`Target Tile ${ts}`);
        targetDashboardId = dashboardPage.getCurrentDashboardId();
      });

      await test.step('Create source dashboard with a Dashboard-mode table tile', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await addTableTile(`E2E Dashboard Link ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Dashboard');
        await dashboardPage.chartEditor.fillRowClickTemplate(
          targetDashboardName,
        );
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

      await test.step('Verify navigated to target dashboard with rendered WHERE', async () => {
        await expect(page).toHaveURL(
          new RegExp(`/dashboards/${targetDashboardId}`),
          { timeout: 10000 },
        );
        const url = new URL(page.url());
        expect(url.pathname).toBe(`/dashboards/${targetDashboardId}`);
        expect(url.searchParams.get('where')).toBe(
          `ServiceName = '${serviceName}'`,
        );
        expect(url.searchParams.get('whereLanguage')).toBe('sql');
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        expect(from).toBeGreaterThan(0);
        expect(to).toBeGreaterThan(from);
        const sixHoursMs = 6 * 60 * 60 * 1000;
        expect(to - from).toBeGreaterThan(sixHoursMs - 60_000);
        expect(to - from).toBeLessThan(sixHoursMs + 60_000);
      });

      await test.step("Verify target dashboard's heading is visible", async () => {
        await expect(
          dashboardPage.getDashboardHeading(targetDashboardName),
        ).toBeVisible({ timeout: 10000 });
      });

      await test.step('Verify no Link error notification appeared', async () => {
        await expect(dashboardPage.getLinkErrorNotification()).toBeHidden();
      });
    });

    test('Dashboard mode: unknown dashboard name shows Link error notification', async () => {
      const ts = Date.now();

      await test.step('Configure Dashboard-mode row click with unresolvable name', async () => {
        await addTableTile(`E2E Bad Dashboard ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Dashboard');
        await dashboardPage.chartEditor.fillRowClickTemplate(
          'Nonexistent Dashboard {{ServiceName}}',
        );
        await dashboardPage.chartEditor.applyRowClickDrawer();
        await dashboardPage.saveTile();
      });

      await dashboardPage.waitForTableTileRows(0);

      await test.step('Click first row and verify Link error appears', async () => {
        const sourceDashboardId = dashboardPage.getCurrentDashboardId();
        await dashboardPage.clickFirstTableRow(0);
        const notification = dashboardPage.getLinkErrorNotification();
        await expect(notification).toBeVisible({ timeout: 5000 });
        await expect(notification).toContainText(
          /Could not find dashboard 'Nonexistent Dashboard /,
        );
        // Should still be on the source dashboard.
        expect(dashboardPage.getCurrentDashboardId()).toBe(sourceDashboardId);
      });
    });

    test('Dashboard mode: WHERE template referencing unknown column shows Link error', async () => {
      const ts = Date.now();
      const targetDashboardName = `E2E Target Dashboard Column ${ts}`;

      await test.step('Create a valid target dashboard', async () => {
        // beforeEach already created a dashboard; repurpose it as the target.
        await dashboardPage.editDashboardName(targetDashboardName);
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart(
          `Target Tile Col ${ts}`,
        );
      });

      await test.step('Create source dashboard with Dashboard-mode tile using bad column WHERE', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await addTableTile(`E2E Bad Column Dashboard ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Dashboard');
        await dashboardPage.chartEditor.fillRowClickTemplate(
          targetDashboardName,
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
        const sourceDashboardId = dashboardPage.getCurrentDashboardId();
        await dashboardPage.clickFirstTableRow(0);
        const notification = dashboardPage.getLinkErrorNotification();
        await expect(notification).toBeVisible({ timeout: 5000 });
        await expect(notification).toContainText(
          /Row has no column 'NonexistentColumn'/,
        );
        expect(dashboardPage.getCurrentDashboardId()).toBe(sourceDashboardId);
      });
    });

    test('Search mode (ID): selecting a source from dropdown navigates to /search using that source id', async ({
      page,
    }) => {
      const ts = Date.now();
      const logSources = await getSources(page, 'log');
      const logsSource = logSources.find(
        (s: { name: string }) => s.name === DEFAULT_LOGS_SOURCE_NAME,
      );
      expect(logsSource).toBeDefined();
      const logsSourceId: string = logsSource.id;

      await test.step('Configure Search-mode row click by selecting source ID from dropdown', async () => {
        await addTableTile(`E2E ID Search Link ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Search');
        await dashboardPage.chartEditor.selectRowClickTarget(
          DEFAULT_LOGS_SOURCE_NAME,
        );
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
      const serviceName = await dashboardPage.getFirstTableRowValue(0, 1);
      expect(serviceName.length).toBeGreaterThan(0);

      await test.step('Click first table row', async () => {
        await dashboardPage.clickFirstTableRow(0);
      });

      await test.step('Verify /search URL uses the selected source id and rendered WHERE', async () => {
        await expect(page).toHaveURL(/\/search\?/, { timeout: 10000 });
        const url = new URL(page.url());
        expect(url.searchParams.get('source')).toBe(logsSourceId);
        expect(url.searchParams.get('whereLanguage')).toBe('sql');
        expect(url.searchParams.get('isLive')).toBe('false');
        expect(url.searchParams.get('where')).toBe(
          `ServiceName = '${serviceName}'`,
        );
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

    test('Dashboard mode (ID): selecting a dashboard from dropdown navigates to that dashboard id', async ({
      page,
    }) => {
      const ts = Date.now();
      const targetDashboardName = `E2E ID Target Dashboard ${ts}`;
      let targetDashboardId = '';

      await test.step('Create the target dashboard', async () => {
        await dashboardPage.editDashboardName(targetDashboardName);
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart(
          `Target Tile ID ${ts}`,
        );
        targetDashboardId = dashboardPage.getCurrentDashboardId();
      });

      await test.step('Create source dashboard with a Dashboard-mode tile selecting target by ID', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await addTableTile(`E2E ID Dashboard Link ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Dashboard');
        await dashboardPage.chartEditor.selectRowClickTarget(
          targetDashboardName,
        );
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
      const serviceName = await dashboardPage.getFirstTableRowValue(0, 1);
      expect(serviceName.length).toBeGreaterThan(0);

      await test.step('Click first table row', async () => {
        await dashboardPage.clickFirstTableRow(0);
      });

      await test.step('Verify navigated to target dashboard via its id and rendered WHERE', async () => {
        await expect(page).toHaveURL(
          new RegExp(`/dashboards/${targetDashboardId}`),
          { timeout: 10000 },
        );
        const url = new URL(page.url());
        expect(url.pathname).toBe(`/dashboards/${targetDashboardId}`);
        expect(url.searchParams.get('where')).toBe(
          `ServiceName = '${serviceName}'`,
        );
        expect(url.searchParams.get('whereLanguage')).toBe('sql');
        const from = Number(url.searchParams.get('from'));
        const to = Number(url.searchParams.get('to'));
        expect(from).toBeGreaterThan(0);
        expect(to).toBeGreaterThan(from);
      });

      await test.step("Verify target dashboard's heading is visible", async () => {
        await expect(
          dashboardPage.getDashboardHeading(targetDashboardName),
        ).toBeVisible({ timeout: 10000 });
      });

      await test.step('Verify no Link error notification appeared', async () => {
        await expect(dashboardPage.getLinkErrorNotification()).toBeHidden();
      });
    });

    test('Search mode: filter templates render into the /search URL filters param', async ({
      page,
    }) => {
      const ts = Date.now();
      const logSources = await getSources(page, 'log');
      const logsSource = logSources.find(
        (s: { name: string }) => s.name === DEFAULT_LOGS_SOURCE_NAME,
      );
      expect(logsSource).toBeDefined();
      const logsSourceId: string = logsSource.id;

      await test.step('Configure Search-mode row click with a filter template', async () => {
        await addTableTile(`E2E Search Filter ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Search');
        await dashboardPage.chartEditor.fillRowClickTemplate(
          DEFAULT_LOGS_SOURCE_NAME,
        );
        await dashboardPage.chartEditor.addOnClickFilterTemplate(
          0,
          'ServiceName',
          '{{ServiceName}}',
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

      await test.step('Verify /search URL has the rendered filter template in filters param', async () => {
        await expect(page).toHaveURL(/\/search\?/, { timeout: 10000 });
        const url = new URL(page.url());
        expect(url.searchParams.get('source')).toBe(logsSourceId);
        const filtersRaw = url.searchParams.get('filters');
        expect(filtersRaw).not.toBeNull();
        const filters = JSON.parse(filtersRaw!);
        expect(filters).toEqual([
          {
            type: 'sql',
            condition: `ServiceName IN ('${serviceName}')`,
          },
        ]);
      });

      await test.step('Verify search page reflects the selected source', async () => {
        await expect(searchPage.currentSource).toHaveValue(
          DEFAULT_LOGS_SOURCE_NAME,
          { timeout: 10000 },
        );
      });
    });

    test('Dashboard mode: filter templates render into the destination dashboard URL filters param', async ({
      page,
    }) => {
      const ts = Date.now();
      const targetDashboardName = `E2E Filter Target ${ts}`;
      let targetDashboardId = '';

      await test.step('Create the target dashboard with a declared filter matching ServiceName', async () => {
        // beforeEach already created a dashboard; repurpose it as the target.
        await dashboardPage.editDashboardName(targetDashboardName);
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart(
          `Filter Target Tile ${ts}`,
        );
        targetDashboardId = dashboardPage.getCurrentDashboardId();
        // Declare a dashboard filter for ServiceName so the ignored-filters
        // banner does NOT appear after navigation.
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.addFilterToDashboard(
          'Service Filter',
          DEFAULT_LOGS_SOURCE_NAME,
          'ServiceName',
        );
        await dashboardPage.closeFiltersModal();
      });

      await test.step('Create source dashboard with Dashboard-mode tile using a filter template', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await addTableTile(`E2E Dashboard Filter ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Dashboard');
        // Selecting the target dashboard auto-populates a filter row per
        // declared DashboardFilter (expression filled, template empty).
        // Just fill the template of the auto-populated ServiceName row.
        await dashboardPage.chartEditor.selectRowClickTarget(
          targetDashboardName,
        );
        await expect(
          dashboardPage.chartEditor.onClickFilterExpressionInput(0),
        ).toHaveValue('ServiceName');
        await dashboardPage.chartEditor
          .onClickFilterTemplateInput(0)
          .fill('{{ServiceName}}');
        await dashboardPage.chartEditor.applyRowClickDrawer();
        await dashboardPage.saveTile();
      });

      await test.step('Set dashboard time range to Last 6 hours', async () => {
        await dashboardPage.timePicker.selectRelativeTime('Last 6 hours');
      });

      await dashboardPage.waitForTableTileRows(0);
      const serviceName = await dashboardPage.getFirstTableRowValue(0, 1);
      expect(serviceName.length).toBeGreaterThan(0);

      await test.step('Click first table row', async () => {
        await dashboardPage.clickFirstTableRow(0);
      });

      await test.step('Verify navigated to target dashboard with rendered filter in URL', async () => {
        await expect(page).toHaveURL(
          new RegExp(`/dashboards/${targetDashboardId}`),
          { timeout: 10000 },
        );
        const url = new URL(page.url());
        expect(url.pathname).toBe(`/dashboards/${targetDashboardId}`);
        const filtersRaw = url.searchParams.get('filters');
        expect(filtersRaw).not.toBeNull();
        const filters = JSON.parse(filtersRaw!);
        expect(filters).toEqual([
          {
            type: 'sql',
            condition: `ServiceName IN ('${serviceName}')`,
          },
        ]);
      });

      await test.step("Verify target dashboard's heading is visible", async () => {
        await expect(
          dashboardPage.getDashboardHeading(targetDashboardName),
        ).toBeVisible({ timeout: 10000 });
      });

      await test.step('Verify no Link error notification appeared', async () => {
        await expect(dashboardPage.getLinkErrorNotification()).toBeHidden();
      });

      await test.step('Verify ignored-filters banner is hidden (filter was declared on target)', async () => {
        await expect(dashboardPage.ignoredUrlFiltersBanner).toBeHidden();
      });
    });

    test('Dashboard mode: ignored-filter warning banner is dismissable', async ({
      page,
    }) => {
      const ts = Date.now();
      const targetDashboardName = `E2E Orphan Filter Target ${ts}`;
      let targetDashboardId = '';

      await test.step('Create the target dashboard with NO declared filters', async () => {
        // beforeEach already created a dashboard; repurpose it as the target.
        await dashboardPage.editDashboardName(targetDashboardName);
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart(
          `Orphan Filter Tile ${ts}`,
        );
        targetDashboardId = dashboardPage.getCurrentDashboardId();
      });

      await test.step('Create source dashboard with Dashboard-mode tile using an undeclared filter expression', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
        await addTableTile(`E2E Orphan Filter Source ${ts}`);
        await dashboardPage.chartEditor.openRowClickDrawer();
        await dashboardPage.chartEditor.setRowClickMode('Dashboard');
        await dashboardPage.chartEditor.selectRowClickTarget(
          targetDashboardName,
        );
        // OrphanExpression is not declared as a filter on the target dashboard,
        // so the warning banner should appear after navigation.
        await dashboardPage.chartEditor.addOnClickFilterTemplate(
          0,
          'OrphanExpression',
          '{{ServiceName}}',
        );
        await dashboardPage.chartEditor.applyRowClickDrawer();
        await dashboardPage.saveTile();
      });

      await test.step('Set dashboard time range to Last 6 hours', async () => {
        await dashboardPage.timePicker.selectRelativeTime('Last 6 hours');
      });

      await dashboardPage.waitForTableTileRows(0);

      await test.step('Click first table row', async () => {
        await dashboardPage.clickFirstTableRow(0);
      });

      await test.step('Verify navigated to target dashboard with filters param in URL', async () => {
        await expect(page).toHaveURL(
          new RegExp(`/dashboards/${targetDashboardId}`),
          { timeout: 10000 },
        );
        const url = new URL(page.url());
        expect(url.searchParams.get('filters')).not.toBeNull();
      });

      await test.step('Verify ignored-filters banner is visible and mentions the orphan expression', async () => {
        await expect(dashboardPage.ignoredUrlFiltersBanner).toBeVisible({
          timeout: 10000,
        });
        await expect(dashboardPage.ignoredUrlFiltersBanner).toContainText(
          'OrphanExpression',
        );
      });

      await test.step('Dismiss the banner and verify it disappears', async () => {
        await dashboardPage.dismissIgnoredUrlFiltersBanner();
        await expect(dashboardPage.ignoredUrlFiltersBanner).toBeHidden();
      });
    });
  },
);
