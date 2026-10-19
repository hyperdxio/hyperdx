/**
 * Values clicked in a dashboard tile update the ad hoc filters that broadcast
 * to it: include / exclude toggle `key = value` / `key != value` on every such
 * filter. Tiles no ad hoc filter reaches offer no filter actions.
 */
import { SidePanelComponent } from '../components/SidePanelComponent';
import { TableComponent } from '../components/TableComponent';
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_SESSIONS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
  INTERESTING_FILTER_KEYS_SOURCE_NAME,
} from '../utils/constants';
import {
  adhocConditionsParam,
  expectFiltersParam,
  type FilterEntry,
  filtersParam,
} from '../utils/filters-param';

test.describe(
  'Ad hoc dashboard filters: click to filter',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

    const addAdhocFilters = async (
      filters: { name: string; sources: string[] }[],
    ) => {
      await dashboardPage.openEditFiltersModal();
      for (const { name, sources } of filters) {
        await dashboardPage.addAdhocFilterToDashboard(name, sources);
      }
      await dashboardPage.closeFiltersModal();
    };

    test('search tile cells update every ad hoc filter on the source', async ({
      page,
    }) => {
      const tile = dashboardPage.getTile(0);
      const conditionsIn = (
        conditions: { key: string; operator: string; value: string }[],
      ): FilterEntry[] => [
        { type: 'adhoc', name: 'Conditions', conditions },
        { type: 'adhoc', name: 'More', conditions },
      ];

      await test.step('Add a search tile with an aliased column and two ad hoc filters', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addSearchTile({
          chartName: 'Logs',
          sourceName: DEFAULT_LOGS_SOURCE_NAME,
          select: 'Timestamp, ServiceName AS svc, Body',
        });
        await expect(dashboardPage.getTiles()).toHaveCount(1);
        await addAdhocFilters([
          { name: 'Conditions', sources: [DEFAULT_LOGS_SOURCE_NAME] },
          { name: 'More', sources: [DEFAULT_LOGS_SOURCE_NAME] },
        ]);
        await expect(
          tile.getByText('frontend', { exact: true }).first(),
        ).toBeVisible({ timeout: 20000 });
      });

      await test.step('Including a value adds key = value on the expression behind the alias', async () => {
        await dashboardPage.filterTileCell(tile, 'accounting', 'include');
        await expectFiltersParam(
          page,
          conditionsIn([
            { key: 'ServiceName', operator: '=', value: 'accounting' },
          ]),
        );
        await expect(tile.getByText('frontend', { exact: true })).toHaveCount(
          0,
        );
      });

      await test.step('Excluding the value replaces the condition', async () => {
        await dashboardPage.filterTileCell(tile, 'accounting', 'exclude');
        await expectFiltersParam(
          page,
          conditionsIn([
            { key: 'ServiceName', operator: '!=', value: 'accounting' },
          ]),
        );
        await expect(
          tile.getByText('frontend', { exact: true }).first(),
        ).toBeVisible();
        await expect(tile.getByText('accounting', { exact: true })).toHaveCount(
          0,
        );
      });

      await test.step('Including a value twice toggles it off', async () => {
        await dashboardPage.filterTileCell(tile, 'frontend', 'include');
        await expectFiltersParam(
          page,
          conditionsIn([
            { key: 'ServiceName', operator: '!=', value: 'accounting' },
            { key: 'ServiceName', operator: '=', value: 'frontend' },
          ]),
        );
        await dashboardPage.filterTileCell(tile, 'frontend', 'include');
        await expectFiltersParam(
          page,
          conditionsIn([
            { key: 'ServiceName', operator: '!=', value: 'accounting' },
          ]),
        );
      });
    });

    test('search tile cells filter on the expressions behind complex columns', async ({
      page,
    }) => {
      const tile = dashboardPage.getTile(0);
      const conditionsIn = (
        conditions: { key: string; operator: string; value: string }[],
      ): FilterEntry[] => [{ type: 'adhoc', name: 'Conditions', conditions }];

      await test.step('Add a search tile with an aliased and an unaliased expression', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addSearchTile({
          chartName: 'Logs',
          sourceName: DEFAULT_LOGS_SOURCE_NAME,
          select:
            'Timestamp, upper(ServiceName) AS svc, lower(ServiceName), Body',
        });
        await expect(dashboardPage.getTiles()).toHaveCount(1);
        await addAdhocFilters([
          { name: 'Conditions', sources: [DEFAULT_LOGS_SOURCE_NAME] },
        ]);
        await expect(
          tile.getByText('FRONTEND', { exact: true }).first(),
        ).toBeVisible({ timeout: 20000 });
      });

      await test.step('An aliased expression filters on the expression', async () => {
        await dashboardPage.filterTileCell(tile, 'ACCOUNTING', 'include');
        await expectFiltersParam(
          page,
          conditionsIn([
            { key: 'upper(ServiceName)', operator: '=', value: 'ACCOUNTING' },
          ]),
        );
        await expect(tile.getByText('FRONTEND', { exact: true })).toHaveCount(
          0,
        );
        await dashboardPage.filterTileCell(tile, 'ACCOUNTING', 'include');
        await expect.poll(() => filtersParam(page) ?? []).toEqual([]);
      });

      await test.step('An unaliased expression filters on the expression', async () => {
        await dashboardPage.filterTileCell(tile, 'frontend', 'exclude');
        await expectFiltersParam(
          page,
          conditionsIn([
            { key: 'lower(ServiceName)', operator: '!=', value: 'frontend' },
          ]),
        );
        await expect(tile.getByText('FRONTEND', { exact: true })).toHaveCount(
          0,
        );
        await expect(
          tile.getByText('ACCOUNTING', { exact: true }).first(),
        ).toBeVisible();
      });
    });

    test('search tile cells filter only where toString() matches the cell', async ({
      page,
    }) => {
      const tile = dashboardPage.getTile(0);
      const conditionsIn = (
        conditions: { key: string; operator: string; value: string }[],
      ): FilterEntry[] => [{ type: 'adhoc', name: 'Conditions', conditions }];

      await test.step('Add a search tile with map, JSON path, and hyphenated columns', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addSearchTile({
          chartName: 'Logs',
          sourceName: INTERESTING_FILTER_KEYS_SOURCE_NAME,
          select:
            'Timestamp, ResourceAttributes, ResourceAttributesJSON.key.subKey.subSubKey, `service-name`',
        });
        await expect(dashboardPage.getTiles()).toHaveCount(1);
        await addAdhocFilters([
          {
            name: 'Conditions',
            sources: [INTERESTING_FILTER_KEYS_SOURCE_NAME],
          },
        ]);
        await expect(
          tile.getByText('svc-one', { exact: true }).first(),
        ).toBeVisible({ timeout: 20000 });
      });

      await test.step('Map cells offer no filter actions', async () => {
        const mapCell = /^\{"key\.subKey\.subSubKey":"value1"\}$/;
        await expect(
          await dashboardPage.getTileCellAction(tile, mapCell, 'copy'),
        ).toBeVisible();
        await expect(
          await dashboardPage.getTileCellAction(tile, mapCell, 'include'),
        ).toHaveCount(0);
      });

      await test.step('A JSON path filters on its unwrapped value', async () => {
        await dashboardPage.filterTileCell(tile, '"value2"', 'include');
        await expectFiltersParam(
          page,
          conditionsIn([
            {
              key: 'ResourceAttributesJSON.key.subKey.subSubKey',
              operator: '=',
              value: 'value2',
            },
          ]),
        );
        await expect(tile.getByText('svc-one', { exact: true })).toHaveCount(0);
        await expect(
          tile.getByText('svc-two', { exact: true }).first(),
        ).toBeVisible();
        await dashboardPage.filterTileCell(tile, '"value2"', 'include');
        await expect.poll(() => filtersParam(page) ?? []).toEqual([]);
      });

      await test.step('A hyphenated column filters on its quoted name', async () => {
        await dashboardPage.filterTileCell(tile, 'svc-one', 'exclude');
        await expectFiltersParam(
          page,
          conditionsIn([
            { key: '`service-name`', operator: '!=', value: 'svc-one' },
          ]),
        );
        await expect(tile.getByText('svc-one', { exact: true })).toHaveCount(0);
        await expect(
          tile.getByText('svc-two', { exact: true }).first(),
        ).toBeVisible();
      });
    });

    test('row side panel fields update the ad hoc filter', async ({ page }) => {
      await dashboardPage.createNewDashboard();
      await dashboardPage.addSearchTile({
        chartName: 'Logs',
        sourceName: DEFAULT_LOGS_SOURCE_NAME,
      });
      await expect(dashboardPage.getTiles()).toHaveCount(1);
      await addAdhocFilters([
        { name: 'Conditions', sources: [DEFAULT_LOGS_SOURCE_NAME] },
      ]);

      const sidePanel = new SidePanelComponent(page, 'row-side-panel');
      const serviceCondition = {
        key: 'ServiceName',
        operator: '=',
        value: expect.any(String),
      };
      const expectServiceCondition = () =>
        expect
          .poll(() => filtersParam(page))
          .toEqual([
            {
              type: 'adhoc',
              name: 'Conditions',
              conditions: [serviceCondition],
            },
          ]);

      await test.step('Add to filters adds a condition', async () => {
        await new TableComponent(page).clickFirstRow();
        await sidePanel.addParsedFieldToFilter('ServiceName');
        await expectServiceCondition();
      });

      await test.step('Adding it again keeps the condition', async () => {
        await sidePanel.addParsedFieldToFilter('ServiceName');
        await expectServiceCondition();
      });

      await test.step('Surrounding context cells are shaped like tile cells', async () => {
        const [{ value: serviceName }] = adhocConditionsParam(
          page,
          'Conditions',
        );
        await sidePanel.clickTab('context');
        const contextTable = sidePanel.contextTab.getByTestId(
          'search-results-table',
        );
        const includeAction = contextTable.getByRole('button', {
          name: 'Toggle filter for this value',
        });
        await contextTable
          .getByText(serviceName, { exact: true })
          .first()
          .hover();
        await expect(includeAction.last()).toBeVisible();
        await contextTable
          .getByText(/\d:\d{2}:\d{2}\.\d{3}/)
          .first()
          .hover();
        await expect(
          contextTable.getByRole('button', { name: 'Copy field value' }).last(),
        ).toBeVisible();
        await expect(includeAction).toHaveCount(0);
      });
    });

    test('offers filter actions only where an ad hoc filter applies', async () => {
      const tile = dashboardPage.getTile(0);
      const expectFilterActions = async (
        count: number,
        value: string | RegExp = 'frontend',
      ) => {
        await expect(
          await dashboardPage.getTileCellAction(tile, value, 'copy'),
        ).toBeVisible();
        await expect(
          await dashboardPage.getTileCellAction(tile, value, 'include'),
        ).toHaveCount(count);
      };

      await test.step('A filter on another source offers none', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addSearchTile({
          chartName: 'Logs',
          sourceName: DEFAULT_LOGS_SOURCE_NAME,
          select: 'Timestamp, ServiceName, Body',
        });
        await expect(dashboardPage.getTiles()).toHaveCount(1);
        await addAdhocFilters([
          { name: 'Traces only', sources: [DEFAULT_TRACES_SOURCE_NAME] },
        ]);
        await expect(
          tile.getByText('frontend', { exact: true }).first(),
        ).toBeVisible({ timeout: 20000 });
        await expectFilterActions(0);
      });

      await test.step('A filter on the tile source offers them', async () => {
        await addAdhocFilters([
          { name: 'Logs', sources: [DEFAULT_LOGS_SOURCE_NAME] },
        ]);
        await expectFilterActions(1);
      });

      await test.step('DateTime cells offer none', async () => {
        await expectFilterActions(0, /\d:\d{2}:\d{2}\.\d{3}/);
      });

      await test.step('Kiosk mode offers none', async () => {
        await dashboardPage.enterKioskMode();
        await expectFilterActions(0);
      });
    });

    test('session search tile cells update the ad hoc filter', async ({
      page,
    }) => {
      const tile = dashboardPage.getTile(0);

      await test.step('Add a session search tile and an ad hoc filter on its source', async () => {
        await dashboardPage.createNewDashboard();
        await dashboardPage.addSearchTile({
          chartName: 'Sessions',
          sourceName: DEFAULT_SESSIONS_SOURCE_NAME,
          select: 'Timestamp, ServiceName, Body',
        });
        await expect(dashboardPage.getTiles()).toHaveCount(1);
        await addAdhocFilters([
          { name: 'Sessions', sources: [DEFAULT_SESSIONS_SOURCE_NAME] },
        ]);
        await expect(
          tile.getByText('browser', { exact: true }).first(),
        ).toBeVisible({ timeout: 20000 });
      });

      await test.step('Including a value adds key = value', async () => {
        await dashboardPage.filterTileCell(tile, 'browser', 'include');
        await expectFiltersParam(page, [
          {
            type: 'adhoc',
            name: 'Sessions',
            conditions: [
              { key: 'ServiceName', operator: '=', value: 'browser' },
            ],
          },
        ]);
      });
    });
  },
);
