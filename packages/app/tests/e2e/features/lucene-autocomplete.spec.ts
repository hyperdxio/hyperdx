/**
 * Lucene autocomplete outside the search page.
 *
 * Field discovery used to be derived from the source id alone, so every input
 * that knew only a table connection offered zero suggestions. The tile editor
 * now passes a source id; the dashboard-wide WHERE spans every tile and has
 * none, so it still leans on the connection. Both are covered here because
 * this exercises the real query path end to end, which the unit tests can't:
 * they mock out the very `useAllFields` call that was never running.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';

test.describe(
  'Lucene autocomplete',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    test('suggests fields and values in the tile editor', async ({ page }) => {
      const dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();

      // Scope everything to the tile editor modal — the dashboard behind it has
      // its own WHERE input with the same markup.
      const editor = page.getByRole('dialog');

      await test.step('Open the tile editor on the logs source', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      });

      const whereInput = editor.getByTestId('series-where-input');

      await test.step('Switch the series WHERE to Lucene', async () => {
        await editor
          .getByTestId('where-language-switch')
          .getByLabel('Query language')
          .click();
        await page.getByRole('option', { name: 'Lucene', exact: true }).click();
        await expect(whereInput).toBeVisible();
      });

      await test.step('Typing a prefix suggests matching fields', async () => {
        await whereInput.click();
        await whereInput.fill('Servi');

        // The field list is debounced by 300ms before the query runs.
        await expect(
          editor
            .getByTestId('autocomplete-suggestion')
            .filter({ hasText: 'ServiceName' })
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      });

      await test.step('Completing the key suggests its values', async () => {
        await whereInput.fill('ServiceName:');

        await expect(
          editor
            .getByTestId('autocomplete-suggestion')
            .filter({ hasText: /^ServiceName:"/ })
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      });
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
        await page
          .getByTestId('where-language-switch')
          .getByLabel('Query language')
          .click();
        await page.getByRole('option', { name: 'Lucene', exact: true }).click();
      });

      await test.step('Typing a prefix suggests matching fields', async () => {
        const whereInput = page.getByTestId('search-input');
        await whereInput.click();
        await whereInput.fill('Servi');

        await expect(
          page
            .getByTestId('autocomplete-suggestion')
            .filter({ hasText: 'ServiceName' })
            .first(),
        ).toBeVisible({ timeout: 15_000 });
      });
    });
  },
);
