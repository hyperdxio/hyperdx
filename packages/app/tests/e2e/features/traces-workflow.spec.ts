import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';
import {
  clearLuceneInput,
  expectFieldSuggestion,
  switchWhereToLucene,
} from '../utils/lucene-autocomplete';

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

      const demoTracesOption = searchPage.page.getByRole('option', {
        name: DEFAULT_TRACES_SOURCE_NAME,
        exact: true,
      });
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

    await test.step('Lucene autocomplete works in the waterfall spans and logs filters', async () => {
      // Two separate inputs over two different sources: the spans filter reads
      // the trace source, the logs filter the correlated log source. Each one
      // has to carry its own source id and the waterfall's date range for field
      // discovery to run at all.
      await searchPage.sidePanel.toggleTraceFilters();

      for (const filter of [
        searchPage.sidePanel.traceSpansFilter,
        searchPage.sidePanel.traceLogsFilter,
      ]) {
        await switchWhereToLucene(filter.getByTestId('where-language-switch'));

        const input = filter.locator('textarea');
        await expectFieldSuggestion(input, {
          prefix: 'Servi',
          field: 'ServiceName',
        });
        // The waterfall rows below are `role=button`, as are the suggestions —
        // leave nothing open for the later span-clicking steps to trip over.
        await clearLuceneInput(input);
      }

      await searchPage.sidePanel.toggleTraceFilters();
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

// trace-0 is four spans in one trace. Opening a result and then another must
// follow the span that was just opened, including a click inside the waterfall
// that is already on screen.
test.describe(
  'Trace waterfall span selection',
  { tag: ['@traces', '@full-stack'] },
  () => {
    let searchPage: SearchPage;

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      await searchPage.goto();
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.timePicker.selectRelativeTime('Last 1 days');
      await searchPage.switchToLuceneMode();
    });

    async function openSpanInWaterfall(spanId: string, spanName: string) {
      await searchPage.performSearch(`SpanId:"${spanId}"`);
      await expect(searchPage.table.firstRow).toBeVisible();
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible();
      await expect(searchPage.sidePanel.getTab('trace')).toBeVisible({
        timeout: 15_000,
      });
      await searchPage.sidePanel.clickTab('trace');
      await expect(
        searchPage.sidePanel.getWaterfallSpan(spanName).first(),
      ).toBeVisible({ timeout: 15_000 });
    }

    test('Opening a span, closing it, opening another span from the same trace', async () => {
      await openSpanInWaterfall('span-0-0', 'GET /api/logs');
      await expect(
        searchPage.sidePanel.getHighlightedWaterfallSpan('GET /api/logs'),
      ).toBeVisible({ timeout: 15_000 });
      await expect(searchPage.sidePanel.spanDetailsPanel).toContainText(
        'GET /api/logs',
        { timeout: 15_000 },
      );

      await searchPage.sidePanel.close();
      await expect(searchPage.sidePanel.container).toBeHidden();

      await openSpanInWaterfall('span-0-1', 'POST /api/traces');
      await expect(
        searchPage.sidePanel.getHighlightedWaterfallSpan('POST /api/traces'),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        searchPage.sidePanel.getHighlightedWaterfallSpan('GET /api/logs'),
      ).toBeHidden();
      await expect(searchPage.sidePanel.spanDetailsPanel).toContainText(
        'POST /api/traces',
        { timeout: 15_000 },
      );
      await expect(searchPage.sidePanel.spanDetailsPanel).not.toContainText(
        'GET /api/logs',
      );
    });

    test('Opening a span, then selecting another span from the same trace without closing the side panel', async () => {
      await searchPage.performSearch('TraceId:"trace-0"');
      await searchPage.table.clickRowContaining('GET /api/logs');
      await expect(searchPage.sidePanel.container).toBeVisible();
      await expect(searchPage.sidePanel.getTab('trace')).toBeVisible({
        timeout: 15_000,
      });
      await searchPage.sidePanel.clickTab('trace');
      await expect(
        searchPage.sidePanel.getHighlightedWaterfallSpan('GET /api/logs'),
      ).toBeVisible({ timeout: 15_000 });

      await searchPage.table.clickRowContaining('POST /api/traces');

      await expect(searchPage.sidePanel.container).toBeVisible();
      await expect(
        searchPage.sidePanel.getHighlightedWaterfallSpan('POST /api/traces'),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        searchPage.sidePanel.getHighlightedWaterfallSpan('GET /api/logs'),
      ).toBeHidden();
      await expect(searchPage.sidePanel.spanDetailsPanel).toContainText(
        'POST /api/traces',
        { timeout: 15_000 },
      );
    });
  },
);
