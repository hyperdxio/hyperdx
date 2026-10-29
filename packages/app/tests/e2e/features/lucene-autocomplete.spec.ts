/**
 * Lucene autocomplete on the dashboard surfaces.
 *
 * Field discovery used to be derived from the source id alone, so every input
 * that knew only a table connection offered zero suggestions. The tile editor
 * now passes a source id; the dashboard-wide WHERE spans every tile and has
 * none, so it still leans on the connection. Both are covered here because
 * this exercises the real query path end to end, which the unit tests can't:
 * they mock out the very `useAllFields` call that was never running.
 *
 * The other inputs the same fix touched are covered where they live: the
 * services dashboard, sessions, the trace waterfall's span/log filters and the
 * Kubernetes dashboard each assert autocomplete in their own spec.
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Page } from '@playwright/test';

import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';
import {
  expectFieldSuggestion,
  expectValueSuggestion,
  switchWhereToLucene,
} from '../utils/lucene-autocomplete';

/**
 * The tile editor modal has no title to match on, so identify it by an input
 * only it renders. Matching `role=dialog` alone is not enough: an open
 * autocomplete dropdown is itself a portalled dialog.
 */
const tileEditor = (page: Page) =>
  page
    .getByRole('dialog')
    .filter({ has: page.getByTestId('chart-name-input') });

test.describe(
  'Lucene autocomplete',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    test('suggests fields and values in the tile editor', async ({ page }) => {
      const dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();

      // Scope the inputs to the tile editor modal — the dashboard behind it has
      // its own WHERE input with the same markup.
      const editor = tileEditor(page);

      await test.step('Open the tile editor on the logs source', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      });

      const whereInput = editor.getByTestId('series-where-input');

      await test.step('Switch the series WHERE to Lucene', async () => {
        await switchWhereToLucene(editor.getByTestId('where-language-switch'));
        await expect(whereInput).toBeVisible();
      });

      await test.step('Typing a prefix suggests matching fields', async () => {
        await expectFieldSuggestion(whereInput, {
          prefix: 'Servi',
          field: 'ServiceName',
        });
      });

      await test.step('Completing the key suggests its values', async () => {
        await expectValueSuggestion(whereInput, { field: 'ServiceName' });
      });
    });

    // The series editor covered above is only one of three WHERE inputs the tile
    // editor can render — which one you get depends on the display type, and
    // each is a separate call site that has to pass the source id along.
    test('suggests fields in the tile editor WHERE for every display type', async ({
      page,
    }) => {
      const dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();

      const editor = tileEditor(page);
      // The display-type-level WHERE inputs carry no test id of their own, so
      // go by the Lucene placeholder. Exactly one renders per display type.
      const whereInput = editor.getByPlaceholder(
        'Search your events w/ Lucene ex. column:foo',
      );

      await test.step('Open the tile editor on the logs source', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      });

      // Switching display type resets `where` but keeps `whereLanguage`, so
      // Lucene only has to be selected once for all three.
      for (const displayType of [
        DisplayType.Search,
        DisplayType.Heatmap,
        DisplayType.EventPatterns,
      ]) {
        await test.step(`Suggests fields for the ${displayType} display type`, async () => {
          await dashboardPage.chartEditor.setChartType(displayType);
          await expect(whereInput).toBeVisible();
          await switchWhereToLucene(
            editor.getByTestId('where-language-switch'),
          );

          await expectFieldSuggestion(whereInput, {
            prefix: 'Servi',
            field: 'ServiceName',
          });
        });
      }
    });

    // The dashboard-wide WHERE spans every tile's source, so it has no single
    // source id to pass — only a list of table connections. It can only work
    // through the table-connection override.
    test('suggests fields in the dashboard-wide WHERE', async ({ page }) => {
      const dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();

      await test.step('Add a tile so the dashboard has a table connection', async () => {
        await dashboardPage.addTileWithSource(
          'Autocomplete tile',
          DEFAULT_LOGS_SOURCE_NAME,
        );
      });

      await test.step('Switch the dashboard WHERE to Lucene', async () => {
        // The SQL editor renders a second switch inside the input itself, so
        // go through the WHERE's own wrapper rather than the bare label.
        await switchWhereToLucene(page.getByTestId('where-language-switch'));
      });

      await test.step('Typing a prefix suggests matching fields', async () => {
        await expectFieldSuggestion(page.getByTestId('search-input'), {
          prefix: 'Servi',
          field: 'ServiceName',
        });
      });
    });

    // A dashboard filter's "Dropdown values filter" narrows the rows its own
    // values are read from. It has a source id but, unlike the tile editor, no
    // date range — so it falls back to the default window.
    test("suggests fields in a dashboard filter's dropdown values WHERE", async ({
      page,
    }) => {
      const dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();

      const filterForm = page
        .getByRole('dialog')
        .filter({ has: page.getByTestId('filter-name-input') });

      await test.step('Open the add-filter form on the logs source', async () => {
        await dashboardPage.openEditFiltersModal();
        await dashboardPage.openAddFilterForm();
        await expect(filterForm).toBeVisible();
        await dashboardPage.selectFilterSource(DEFAULT_LOGS_SOURCE_NAME);
      });

      const whereInput = filterForm.getByPlaceholder(
        'Filter for dropdown values',
      );

      await test.step('Switch the dropdown values filter to Lucene', async () => {
        await switchWhereToLucene(
          filterForm.getByTestId('where-language-switch'),
        );
        await expect(whereInput).toBeVisible();
      });

      await test.step('Typing a prefix suggests matching fields', async () => {
        await expectFieldSuggestion(whereInput, {
          prefix: 'Servi',
          field: 'ServiceName',
        });
      });
    });
  },
);
