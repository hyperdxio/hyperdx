import { SearchPage } from '../../page-objects/SearchPage';
import { JSON_BODY_LOG } from '../../seed-clickhouse';
import { expect, test } from '../../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../../utils/constants';

// Re-running the search query after a filter change can take longer than
// Playwright's 5s assertion default on slow CI runners.
const QUERY_TIMEOUT = 20_000;

// HDX-4427: "Add to Filters" on a value inside parsed JSON from a String column
// (Body) builds a JSONExtractString(...) expression as the filter key. Before
// the fix this serialized to invalid SQL and ClickHouse rejected the query, so
// the whole search errored. This drives the real UI path end to end against
// ClickHouse: add the filter from the row side panel, then confirm the query
// runs without error and still returns the matching row.
test.describe(
  'Search: parsed-JSON "Add to Filters"',
  { tag: ['@search', '@full-stack'] },
  () => {
    test('filtering on a nested JSON Body value runs without a ClickHouse error', async ({
      page,
    }) => {
      const searchPage = new SearchPage(page);
      await searchPage.goto();
      await searchPage.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      await searchPage.timePicker.selectRelativeTime('Last 1 hour');

      // Isolate the seeded JSON-body row so the side panel opens on it.
      await searchPage.performSearch(
        `ServiceName:"${JSON_BODY_LOG.serviceName}"`,
      );
      await expect(searchPage.getTableError()).toHaveCount(0);
      await expect(searchPage.table.getRows()).toHaveCount(1, {
        timeout: QUERY_TIMEOUT,
      });

      // Open the row, then add a filter on the nested JSON value from the
      // parsed tab. This builds JSONExtractString(Body, 'app.user.currency').
      await searchPage.table.clickFirstRow();
      await searchPage.sidePanel.addParsedJsonFieldToFilter(
        'Body',
        JSON_BODY_LOG.jsonKey,
      );

      // The filter is built from the nested key as a JSONExtractString
      // expression and persisted to the URL.
      await expect(page).toHaveURL(/JSONExtractString/);
      // The generated SQL must be valid: no table error and the matching row
      // still comes back. Before the fix the mangled key produced invalid SQL
      // that ClickHouse rejected, so the query errored and returned no rows.
      await expect(searchPage.getTableError()).toHaveCount(0, {
        timeout: QUERY_TIMEOUT,
      });
      await expect(searchPage.table.getRows()).toHaveCount(1, {
        timeout: QUERY_TIMEOUT,
      });
    });
  },
);
