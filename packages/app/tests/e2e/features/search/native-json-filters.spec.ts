import { SearchPage } from '../../page-objects/SearchPage';
import { INTERESTING_FILTER_KEYS_ROWS } from '../../seed-clickhouse';
import { expect, test } from '../../utils/base-test';
import { INTERESTING_FILTER_KEYS_SOURCE_NAME } from '../../utils/constants';

const [ROW1, ROW2, ROW3] = INTERESTING_FILTER_KEYS_ROWS;
const QUERY_TIMEOUT = 20_000;

test.describe(
  'Search: native JSON filters',
  { tag: ['@search', '@full-stack'] },
  () => {
    for (const { path, values } of [
      {
        path: 'key.subKey.subSubKey',
        values: [ROW1.jsonValue, ROW2.jsonValue, ROW3.jsonValue],
      },
      {
        path: 'integer',
        values: [ROW1.jsonInteger, ROW2.jsonInteger, ROW3.jsonInteger].map(
          String,
        ),
      },
      {
        path: 'boolean',
        values: [ROW1.jsonBoolean, ROW2.jsonBoolean].map(String),
      },
      {
        path: 'mixed',
        values: [ROW1.jsonMixed, ROW2.jsonMixed, ROW3.jsonMixed].map(String),
      },
    ]) {
      test(`loads, includes and excludes ${path}`, async ({ page }) => {
        const searchPage = new SearchPage(page);
        await searchPage.goto();
        await searchPage.selectSource(INTERESTING_FILTER_KEYS_SOURCE_NAME);
        await searchPage.timePicker.selectRelativeTime('Last 1 hour');
        await searchPage.table.waitForRowsToPopulate();

        // Native JSON discovery is disabled; existing personal pins still expose
        // the field and its real "Load more" query without mocking facet values.
        const sourceId = new URL(page.url()).searchParams.get('source');
        expect(sourceId).toBeTruthy();
        await page.evaluate(
          ({ sourceId, field }) => {
            localStorage.setItem(
              'hdx-pinned-fields',
              JSON.stringify({ [sourceId!]: [field] }),
            );
          },
          { sourceId, field: `ResourceAttributesJSON.${path}` },
        );
        await page.reload();

        await page
          .getByTestId(`nested-filter-group-ResourceAttributesJSON.${path}`)
          .click();
        await page.getByTestId(`filter-load-more-${path}`).click();
        for (const value of values) {
          await expect(
            searchPage.filters.getFilterCheckboxInput(path, value),
          ).toBeVisible({ timeout: QUERY_TIMEOUT });
        }

        await searchPage.filters.showDistribution(path);
        await expect(
          searchPage.filters.getDistributionPercentage(path, values[0]),
        ).toContainText('33', { timeout: QUERY_TIMEOUT });

        const rows = searchPage.table.getRows();
        await searchPage.filters.applyFilter(path, values[0]);
        await expect(rows).toHaveCount(1, { timeout: QUERY_TIMEOUT });
        await expect(rows).toContainText(ROW1.body);
        await expect(searchPage.getTableError()).toHaveCount(0);

        await page.reload();
        await expect(page).toHaveURL(/filters=/);
        await expect(rows).toHaveCount(1, { timeout: QUERY_TIMEOUT });
        await expect(rows).toContainText(ROW1.body);
        await expect(searchPage.getTableError()).toHaveCount(0);

        await page.getByTestId(`filter-load-more-${path}`).click();
        await expect(
          searchPage.filters.getFilterCheckboxInput(path, values[1]),
        ).toBeVisible({ timeout: QUERY_TIMEOUT });
        await expect(
          searchPage.filters.getFilterCheckboxInput(path, values[0]),
        ).toBeChecked();
        await searchPage.filters
          .getFilterCheckboxInput(path, values[0])
          .click();
        await expect(rows).toHaveCount(3, { timeout: QUERY_TIMEOUT });
        await expect(searchPage.getTableError()).toHaveCount(0);

        await page.getByTestId(`filter-load-more-${path}`).click();
        await expect(
          searchPage.filters.getFilterCheckboxInput(path, values[0]),
        ).toBeVisible({ timeout: QUERY_TIMEOUT });
        await expect(
          searchPage.filters.getFilterCheckboxInput(path, values[0]),
        ).not.toBeChecked();
        await searchPage.filters.excludeFilter(path, values[0]);
        await expect(rows).toHaveCount(2, { timeout: QUERY_TIMEOUT });
        await expect(rows.filter({ hasText: ROW1.body })).toHaveCount(0);
        await expect(rows.filter({ hasText: ROW2.body })).toHaveCount(1);
        await expect(rows.filter({ hasText: ROW3.body })).toHaveCount(1);
        await expect(searchPage.getTableError()).toHaveCount(0);

        await page.reload();
        await expect(page).toHaveURL(/filters=/);
        await expect(rows).toHaveCount(2, { timeout: QUERY_TIMEOUT });
        await expect(rows.filter({ hasText: ROW1.body })).toHaveCount(0);
        await expect(searchPage.getTableError()).toHaveCount(0);

        await page
          .getByTestId(`nested-filter-group-ResourceAttributesJSON.${path}`)
          .locator('button:has(.tabler-icon-filter-off)')
          .click();
        await expect(rows).toHaveCount(3, { timeout: QUERY_TIMEOUT });
        await expect(searchPage.getTableError()).toHaveCount(0);
      });
    }
  },
);
