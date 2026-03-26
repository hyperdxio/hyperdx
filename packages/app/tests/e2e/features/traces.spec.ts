import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';

test.describe('Traces', { tag: '@traces' }, () => {
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

      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible({
        timeout: 10000,
      });
    });
  });

  test('should view trace waterfall and navigate trace details', async () => {
    await test.step('Select traces source', async () => {
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();
    });

    await test.step('Search for Order traces', async () => {
      await searchPage.timePicker.selectRelativeTime('Last 1 days');
      await searchPage.performSearch('Order');
    });

    await test.step('Open side panel and navigate to trace tab', async () => {
      await expect(searchPage.table.firstRow).toBeVisible();
      await searchPage.table.clickFirstRow();

      await expect(searchPage.sidePanel.container).toBeVisible();
      await searchPage.sidePanel.clickTab('trace');

      await expect(searchPage.sidePanel.getTabPanel('trace')).toBeVisible({
        timeout: 5000,
      });
    });

    await test.step('Verify trace timeline elements are visible', async () => {
      const traceTimelineElements = searchPage.page
        .locator('[role="button"]')
        .filter({ hasText: /\w+/ });

      await expect(traceTimelineElements.first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step('Verify event detail tabs', async () => {
      const overviewTab = searchPage.page.locator('text=Overview').first();
      const columnValuesTab = searchPage.page
        .locator('text=Column Values')
        .first();

      await expect(overviewTab).toBeVisible();
      await expect(columnValuesTab).toBeVisible();
    });

    await test.step('Verify trace attributes are displayed', async () => {
      const traceAttributes = ['TraceId', 'SpanId', 'SpanName'];

      for (const attribute of traceAttributes) {
        const attributeElement = searchPage.page
          .locator(`div[class*="HyperJson_key__"]`)
          .filter({ hasText: new RegExp(`^${attribute}$`) });
        await expect(attributeElement).toBeVisible();
      }

      await searchPage.page.keyboard.press('PageDown');

      const topLevelAttributesSection = searchPage.page.locator(
        'text=Top Level Attributes',
      );
      await expect(topLevelAttributesSection).toBeVisible();

      const spanAttributesSection = searchPage.page.locator(
        'text=Span Attributes',
      );
      await expect(spanAttributesSection).toBeVisible();
    });
  });
});
