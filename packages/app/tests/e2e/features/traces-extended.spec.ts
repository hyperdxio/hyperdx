import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';

test.describe('Traces Extended', { tag: '@traces' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('should search for traces and display results', async () => {
    await test.step('Select traces source', async () => {
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();
    });

    await test.step('Search for Order traces', async () => {
      await searchPage.performSearch('Order');
    });

    await test.step('Verify search results are displayed', async () => {
      const resultsTable = searchPage.getSearchResultsTable();
      await expect(resultsTable).toBeVisible();
      await expect(searchPage.table.firstRow).toBeVisible();
    });
  });

  test('should open trace details and see side panel tabs', async () => {
    await test.step('Select traces source and search', async () => {
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();
    });

    await test.step('Click first row to open side panel', async () => {
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step('Verify side panel tabs are available', async () => {
      await expect(searchPage.sidePanel.tabs).toBeVisible({ timeout: 10000 });

      // Trace and Parsed tabs are always present for trace sources
      await expect(searchPage.sidePanel.getTab('trace')).toBeVisible({
        timeout: 10000,
      });
      await expect(searchPage.sidePanel.getTab('parsed')).toBeVisible();
    });
  });

  test('should filter traces by span name', async () => {
    await test.step('Select traces source', async () => {
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();
    });

    await test.step('Search for AddItem span name', async () => {
      await searchPage.performSearch('AddItem');
    });

    await test.step('Verify results contain matching span', async () => {
      await expect(searchPage.table.firstRow).toBeVisible();

      // Click the first row to verify it's an AddItem span
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible({
        timeout: 10000,
      });
    });
  });
});
