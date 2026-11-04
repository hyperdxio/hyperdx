/**
 * Selecting an at-prefixed JSON key breaks row details.
 *
 * When a displayed SELECT column is a JSON subcolumn whose key is not a bare
 * identifier (e.g. `ResourceAttributesJSON.`@request_id``), ClickHouse reports
 * the result column name without backticks (`ResourceAttributesJSON.@request_id`).
 * The row side panel rebuilds a WHERE clause from the displayed columns to fetch
 * the full row; before the fix it used that bare name verbatim, producing
 * invalid SQL that matched no rows, so the panel came up empty.
 *
 * This drives the real UI path against a JSON-column schema: select the
 * at-prefixed key, open the row, and confirm the detail panel is populated with
 * the selected event's values.
 */
import { SearchPage } from '../../page-objects/SearchPage';
import {
  INTERESTING_FILTER_KEYS_JSON_AT_KEY,
  INTERESTING_FILTER_KEYS_ROWS,
} from '../../seed-clickhouse';
import { expect, test } from '../../utils/base-test';
import { INTERESTING_FILTER_KEYS_SOURCE_NAME } from '../../utils/constants';

const QUERY_TIMEOUT = 20_000;

const [ROW1] = INTERESTING_FILTER_KEYS_ROWS;

test.describe(
  'Search: at-prefixed JSON key row details',
  { tag: ['@search', '@full-stack'] },
  () => {
    test('opening a row with an at-prefixed JSON key in SELECT shows the event', async ({
      page,
    }) => {
      const searchPage = new SearchPage(page);
      await searchPage.goto();
      await searchPage.selectSource(INTERESTING_FILTER_KEYS_SOURCE_NAME);
      await searchPage.timePicker.selectRelativeTime('Last 1 hour');

      await test.step('isolate a single row', async () => {
        await searchPage.performSearch(`ServiceName:"${ROW1.serviceName}"`);
        await expect(searchPage.getTableError()).toHaveCount(0);
        await expect(searchPage.table.getRows()).toHaveCount(1, {
          timeout: QUERY_TIMEOUT,
        });
      });

      await test.step('select the at-prefixed JSON key as a column', async () => {
        await searchPage.setCustomSELECT(
          `Timestamp, ServiceName, ResourceAttributesJSON.\`${INTERESTING_FILTER_KEYS_JSON_AT_KEY}\``,
        );
        await searchPage.submitEmptySearch();
        await expect(searchPage.getTableError()).toHaveCount(0);
        await expect(searchPage.table.getRows()).toHaveCount(1, {
          timeout: QUERY_TIMEOUT,
        });
      });

      await test.step('row details load the selected event', async () => {
        await searchPage.table.clickFirstRow();
        await expect(searchPage.sidePanel.container).toBeVisible();
        // Before the fix the detail WHERE dropped the key's backticks and
        // matched no rows, so the panel rendered empty with no error.
        await expect(searchPage.sidePanel.errorState).toHaveCount(0);

        await searchPage.sidePanel.openColumnValues();
        await expect(
          searchPage.sidePanel.columnValue(ROW1.jsonAtKeyValue),
        ).toBeVisible({ timeout: QUERY_TIMEOUT });
        await expect(searchPage.sidePanel.columnValue(ROW1.body)).toBeVisible();
      });
    });
  },
);
