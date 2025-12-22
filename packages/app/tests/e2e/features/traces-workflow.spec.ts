import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';

test.describe('Advanced Search Workflow - Traces', { tag: '@traces' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('Comprehensive traces workflow - search, view waterfall, navigate trace details', async () => {
    await test.step('Select Demo Traces data source', async () => {
      const sourceSelector = searchPage.page.locator(
        '[data-testid="source-selector"]',
      );
      await expect(sourceSelector).toBeVisible();
      await sourceSelector.click();

      const demoTracesOption = searchPage.page.locator(
        `text=${DEFAULT_TRACES_SOURCE_NAME}`,
      );
      await expect(demoTracesOption).toBeVisible();
      await demoTracesOption.click();
    });

    await test.step('Search for Order traces', async () => {
      await expect(searchPage.input).toBeVisible();
      await searchPage.input.fill('Order');

      // Use time picker component
      await searchPage.timePicker.selectRelativeTime('Last 1 days');

      // Perform search
      await searchPage.performSearch('Order');
    });

    await test.step('Verify search results', async () => {
      const searchResultsTable = searchPage.getSearchResultsTable();
      await expect(searchResultsTable).toBeVisible();
    });

    await test.step('Click on first trace result and open side panel', async () => {
      // Use table component to click first row
      await expect(searchPage.table.firstRow).toBeVisible();
      await searchPage.table.clickFirstRow();

      // Verify side panel opens
      await expect(searchPage.sidePanel.container).toBeVisible();
    });

    await test.step('Navigate to trace tab and verify trace visualization', async () => {
      // Use side panel component to navigate to trace tab
      await searchPage.sidePanel.clickTab('trace');

      // Verify trace panel is visible
      const tracePanel = searchPage.page.locator(
        '[data-testid="side-panel-tab-trace"]',
      );
      await expect(tracePanel).toBeVisible({ timeout: 5000 });

      // Look for trace timeline elements (the spans/timeline labels that show in trace view)
      const traceTimelineElements = searchPage.page
        .locator('[role="button"]')
        .filter({ hasText: /\w+/ });

      // Verify we have trace timeline elements (spans) visible using web-first assertion
      await expect(traceTimelineElements.first()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step('Verify event details and navigation tabs', async () => {
      const overviewTab = searchPage.page.locator('text=Overview').first();
      const columnValuesTab = searchPage.page
        .locator('text=Column Values')
        .first();

      await expect(overviewTab).toBeVisible();
      await expect(columnValuesTab).toBeVisible();
    });

    await test.step('Interact with span elements in trace waterfall', async () => {
      // Look for clickable trace span elements (buttons with role="button")
      const spanElements = searchPage.page
        .locator('[role="button"]')
        .filter({ hasText: /CartService|AddItem|POST|span|trace/ });

      // Verify we have span elements using web-first assertion
      await expect(spanElements.first()).toBeVisible({ timeout: 5000 });

      const spanCount = await spanElements.count();
      if (spanCount > 1) {
        const secondSpan = spanElements.nth(1);
        await secondSpan.scrollIntoViewIfNeeded();
        await secondSpan.click({ timeout: 3000 });
      }
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

      // Look for section headers
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
