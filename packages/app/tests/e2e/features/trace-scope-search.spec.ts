import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';

test.describe(
  'Trace-level AND search across spans',
  { tag: ['@full-stack', '@search', '@traces'] },
  () => {
    let searchPage: SearchPage;

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      await searchPage.goto();
    });

    test('toggling to trace scope runs the search and surfaces the trace-scope indicator', async () => {
      await test.step('Select the traces data source', async () => {
        await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      });

      await test.step('Scope defaults to span and both options are reachable', async () => {
        await expect(searchPage.searchScopeControl).toBeVisible();
        await expect(searchPage.spanScopeOption).toBeChecked();
        await expect(searchPage.traceScopeOption).toBeEnabled();
      });

      await test.step('Switch to trace scope and run the search', async () => {
        await searchPage.timePicker.selectRelativeTime('Last 1 days');
        await searchPage.selectTraceScope();
        await expect(searchPage.traceScopeOption).toBeChecked();
        await searchPage.performSearch('');
      });

      await test.step('The results header reports the trace scope', async () => {
        await expect(searchPage.resultScopeIndicator).toBeVisible();
      });
    });

    test('a trace-scoped query with no match shows the labelled trace-zero empty, not a blank', async () => {
      await test.step('Select the traces data source', async () => {
        await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      });

      await test.step('Run a trace-scoped query that matches nothing', async () => {
        await searchPage.timePicker.selectRelativeTime('Last 1 days');
        await searchPage.selectTraceScope();
        await searchPage.performSearch('ServiceName:"nonexistent-service-e2e"');
      });

      await test.step('The trustworthy trace-zero empty is shown', async () => {
        await expect(searchPage.traceZeroEmptyState).toBeVisible();
      });
    });
  },
);
