import { Page } from '@playwright/test';

import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../../utils/constants';

// "Search for this value only" on an event from a correlated source (a log
// opened from a trace search) must not pivot the search to the log source.
// It keeps the searched trace source and replaces the search box with a
// trace-id subquery on the log table (HDX-5195).
test.describe(
  'Cross-source search from a trace waterfall',
  { tag: '@search' },
  () => {
    let searchPage: SearchPage;

    const tracePanel = (page: Page) => page.getByTestId('side-panel-tab-trace');

    // Open trace-0's waterfall from a trace search and select its correlated
    // log event, so the detail panel renders a cross-source (log) event.
    // Returns the searched trace source's id (an ObjectId in full-stack mode),
    // so the tests can assert the generated search kept it.
    const openCorrelatedLogEvent = async (page: Page): Promise<string> => {
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.timePicker.selectRelativeTime('Last 1 days');
      await searchPage.performSearch('TraceId:"trace-0"');
      const searchedSourceId = new URL(page.url()).searchParams.get('source');
      expect(searchedSourceId).toBeTruthy();

      await expect(searchPage.table.firstRow).toBeVisible();
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.tabs).toBeVisible();
      await searchPage.sidePanel.clickTab('trace');
      await expect(tracePanel(page)).toBeVisible({ timeout: 10_000 });

      // Log rows in the waterfall are marked by the correlated-log icon.
      const logRow = tracePanel(page)
        .locator('[role="button"]')
        .filter({ has: page.locator('[aria-label="Correlated Log Line"]') })
        .first();
      await expect(logRow).toBeVisible({ timeout: 10_000 });
      await logRow.click();
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      return searchedSourceId as string;
    };

    // The generated search state, parsed from the URL the action navigated to.
    const searchParamsFromUrl = (page: Page) =>
      new URL(page.url()).searchParams;

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      await searchPage.goto();
    });

    test('Column Values search action builds a trace-id subquery and stays on the trace source', async ({
      page,
    }) => {
      const searchedSourceId = await openCorrelatedLogEvent(page);

      await test.step("Trigger the search action on the log event's ServiceName", async () => {
        await tracePanel(page).getByText('Column Values').first().click();

        const line = tracePanel(page)
          .getByTestId('json-viewer-line')
          .filter({ has: page.getByText('ServiceName', { exact: true }) })
          .first();
        await expect(line).toBeVisible({ timeout: 10_000 });
        await line.hover();
        await line.getByTitle('Search for this value only').click();
      });

      await test.step('The search stays on the trace source with the subquery in the box', async () => {
        // The seeded logs correlated to trace-0 all carry ServiceName
        // 'api-server', so the condition is stable regardless of which log
        // event the waterfall listed first.
        await expect
          .poll(() => searchParamsFromUrl(page).get('where'))
          .toBe(
            "TraceId IN (SELECT TraceId FROM default.e2e_otel_logs WHERE ServiceName = 'api-server')",
          );
        const params = searchParamsFromUrl(page);
        expect(params.get('source')).toBe(searchedSourceId);
        expect(params.get('whereLanguage')).toBe('sql');
        await expect(searchPage.currentSource).toHaveValue(
          DEFAULT_TRACES_SOURCE_NAME,
        );
      });

      await test.step("The subquery executes and finds the parent trace's spans", async () => {
        await searchPage.table.waitForRowsToPopulate();
        await expect(searchPage.getTableError()).toHaveCount(0);
      });
    });

    test('Overview attribute chip emits a SQL condition inside the subquery', async ({
      page,
    }) => {
      const searchedSourceId = await openCorrelatedLogEvent(page);

      await test.step('Search from a resource-attribute chip on the Overview tab', async () => {
        // EventTag chips render as .bg-highlighted pills; the accordion
        // sections are expanded by default.
        const chip = tracePanel(page)
          .locator('.bg-highlighted')
          .filter({ hasText: 'environment' })
          .first();
        await chip.scrollIntoViewIfNeeded();
        await expect(chip).toBeVisible({ timeout: 10_000 });
        await chip.click();
        await page
          .getByRole('button', { name: 'Search This Value' })
          .click({ timeout: 5_000 });
      });

      await test.step("The chip's condition lands in the subquery in SQL form, not lucene", async () => {
        await expect
          .poll(() => searchParamsFromUrl(page).get('where'))
          .toBe(
            "TraceId IN (SELECT TraceId FROM default.e2e_otel_logs WHERE ResourceAttributes['environment'] = 'test')",
          );
        const params = searchParamsFromUrl(page);
        expect(params.get('source')).toBe(searchedSourceId);
        expect(params.get('whereLanguage')).toBe('sql');
        await expect(searchPage.currentSource).toHaveValue(
          DEFAULT_TRACES_SOURCE_NAME,
        );

        await searchPage.table.waitForRowsToPopulate();
        await expect(searchPage.getTableError()).toHaveCount(0);
      });
    });
  },
);
