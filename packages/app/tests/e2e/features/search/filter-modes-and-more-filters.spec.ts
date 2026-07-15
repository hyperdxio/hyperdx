import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../../utils/constants';

const FILTER_QUERY_TIMEOUT = 20_000;

const LOW_CARDINALITY_FILTER = 'SeverityText';
const NON_LOW_CARDINALITY_FILTER = 'TraceId';

async function openFilterSettings(searchPage: SearchPage) {
  await searchPage.page
    .getByRole('button', { name: 'Filter settings' })
    .click();
}

async function setShowAllValues(searchPage: SearchPage, checked: boolean) {
  await openFilterSettings(searchPage);
  const showAllCheckbox = searchPage.page.getByRole('checkbox', {
    name: 'Show All Values',
  });
  const currentlyChecked = await showAllCheckbox.isChecked();
  if (currentlyChecked !== checked) {
    await showAllCheckbox.click();
  }
  await searchPage.page.keyboard.press('Escape');
}

test.describe(
  'Filter modes (all vs exact) and More filters',
  { tag: ['@search'] },
  () => {
    let searchPage: SearchPage;

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      await searchPage.goto();
      await searchPage.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      await searchPage.timePicker.selectRelativeTime('Last 1 hour');
      await searchPage.table.waitForRowsToPopulate();
    });

    test('all mode loads low-cardinality filters by default', async () => {
      await setShowAllValues(searchPage, true);

      await expect(
        searchPage.filters.getFilterGroup(LOW_CARDINALITY_FILTER),
      ).toBeVisible({ timeout: FILTER_QUERY_TIMEOUT });

      await searchPage.filters.openFilterGroup(LOW_CARDINALITY_FILTER);
      await expect(
        searchPage.filters.getFilterCheckboxInput(
          LOW_CARDINALITY_FILTER,
          'info',
        ),
      ).toBeVisible({ timeout: FILTER_QUERY_TIMEOUT });
    });

    test('exact mode loads low-cardinality filters when Show All Values is off', async () => {
      await setShowAllValues(searchPage, false);

      await expect(
        searchPage.filters.getFilterGroup(LOW_CARDINALITY_FILTER),
      ).toBeVisible({ timeout: FILTER_QUERY_TIMEOUT });

      await searchPage.filters.openFilterGroup(LOW_CARDINALITY_FILTER);
      await expect(
        searchPage.filters.getFilterCheckboxInput(
          LOW_CARDINALITY_FILTER,
          'info',
        ),
      ).toBeVisible({ timeout: FILTER_QUERY_TIMEOUT });
    });

    test('More filters reveals non-low-cardinality columns in all mode', async () => {
      await setShowAllValues(searchPage, true);

      await expect(
        searchPage.filters.getFilterGroup(NON_LOW_CARDINALITY_FILTER),
      ).toHaveCount(0);

      await searchPage.filters.showMoreFilters();

      await expect(
        searchPage.filters.getFilterGroup(NON_LOW_CARDINALITY_FILTER),
      ).toBeVisible({ timeout: FILTER_QUERY_TIMEOUT });
    });

    test('More filters reveals non-low-cardinality columns in exact mode', async () => {
      await setShowAllValues(searchPage, false);

      await expect(
        searchPage.filters.getFilterGroup(NON_LOW_CARDINALITY_FILTER),
      ).toHaveCount(0);

      await searchPage.filters.showMoreFilters();

      await expect(
        searchPage.filters.getFilterGroup(NON_LOW_CARDINALITY_FILTER),
      ).toBeVisible({ timeout: FILTER_QUERY_TIMEOUT });
    });
  },
);
