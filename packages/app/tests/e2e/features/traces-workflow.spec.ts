import { expect, test } from '../utils/base-test';

test.describe('Advanced Search Workflow - Traces', { tag: '@traces' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
  });

  test('Comprehensive traces workflow - search, view waterfall, navigate trace details', async ({
    page,
  }) => {
    await test.step('Select Demo Traces data source', async () => {
      const sourceSelector = page.locator('[data-testid="source-selector"]');
      await expect(sourceSelector).toBeVisible();
      await sourceSelector.click();
      await page.waitForTimeout(500);

      const demoTracesOption = page.locator('text=Demo Traces');
      await expect(demoTracesOption).toBeVisible();
      await demoTracesOption.click();
      await page.waitForTimeout(1000);
    });

    await test.step('Search for Order traces', async () => {
      const searchInput = page.locator('[data-testid="search-input"]');
      await expect(searchInput).toBeVisible();
      await searchInput.fill('Order');

      await page.locator('[data-testid="time-picker-input"]').click();
      await page.locator('text=Last 1 days').click();

      const searchSubmitButton = page.locator(
        '[data-testid="search-submit-button"]',
      );
      await searchSubmitButton.click();

      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    });

    await test.step('Verify search results', async () => {
      const searchResultsTable = page.locator(
        '[data-testid="search-results-table"]',
      );
      await expect(searchResultsTable).toBeVisible();
    });

    await test.step('Click on first trace result and open side panel', async () => {
      const searchResultsTable = page.locator(
        '[data-testid="search-results-table"]',
      );
      const firstRow = searchResultsTable.locator('tr').nth(1);
      await expect(firstRow).toBeVisible();

      await firstRow.click();
      await page.waitForTimeout(1000);

      // Use the main side panel container to verify it is visible
      const sidePanel = page.locator('[data-testid="row-side-panel"]');
      await expect(sidePanel).toBeVisible();
    });

    await test.step('Navigate to trace tab and verify trace visualization', async () => {
      const traceTab = page.locator('[data-testid="tab-trace"]');
      await expect(traceTab).toBeVisible();
      await traceTab.click();
      await page.waitForTimeout(1000);

      // Verify trace visualization is present - check for trace content
      const tracePanel = page.locator('[data-testid="side-panel-tab-trace"]');
      await expect(tracePanel).toBeVisible({ timeout: 5000 });

      // Wait for trace data to load and verify trace content is displayed
      await page.waitForTimeout(2000);

      // Look for trace timeline elements (the spans/timeline labels that show in trace view)
      const traceTimelineElements = page
        .locator('[role="button"]')
        .filter({ hasText: /\w+/ });
      const timelineElementsCount = await traceTimelineElements.count();

      // Verify we have trace timeline elements (spans) visible
      expect(timelineElementsCount).toBeGreaterThan(0);
    });

    await test.step('Verify event details and navigation tabs', async () => {
      const overviewTab = page.locator('text=Overview').first();
      const columnValuesTab = page.locator('text=Column Values').first();

      await expect(overviewTab).toBeVisible();
      await expect(columnValuesTab).toBeVisible();
    });

    await test.step('Interact with span elements in trace waterfall', async () => {
      // Look for clickable trace span elements (buttons with role="button")
      const spanElements = page
        .locator('[role="button"]')
        .filter({ hasText: /CartService|AddItem|POST|span|trace/ });
      const spanCount = await spanElements.count();
      expect(spanCount).toBeGreaterThan(0);

      if (spanCount > 1) {
        const secondSpan = spanElements.nth(1);
        await secondSpan.scrollIntoViewIfNeeded();
        await secondSpan.click({ timeout: 3000 });
        await page.waitForTimeout(1000);
      }
    });

    await test.step('Verify trace attributes are displayed', async () => {
      const traceAttributes = ['TraceId', 'SpanId', 'SpanName'];

      for (const attribute of traceAttributes) {
        const attributeElement = page
          .locator(`div[class*="HyperJson_key__"]`)
          .filter({ hasText: new RegExp(`^${attribute}$`) });
        await expect(attributeElement).toBeVisible();
      }

      await page.keyboard.press('PageDown');
      await page.waitForTimeout(500);

      // Look for section headers that might not be in HyperJson_key divs
      const topLevelAttributesSection = page.locator(
        'text=Top Level Attributes',
      );
      await expect(topLevelAttributesSection).toBeVisible();

      const spanAttributesSection = page.locator('text=Span Attributes');
      await expect(spanAttributesSection).toBeVisible();
    });
  });
});
