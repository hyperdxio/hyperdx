import { SearchPage } from '../../page-objects/SearchPage';
import { SEVERITY_CLASS_ROWS } from '../../seed-clickhouse';
import { expect, test } from '../../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  SEVERITY_CLASS_LOGS_SOURCE_NAME,
} from '../../utils/constants';

const FACET = 'Severity';
const QUERY_TIMEOUT = 20_000;

const errorRows = SEVERITY_CLASS_ROWS.filter(r => r.severityClass === 'ERROR');
// SeverityText says error, but the SeverityNumber class wins.
const numberWinsRows = SEVERITY_CLASS_ROWS.filter(
  r => r.severityClass !== 'ERROR' && r.text === 'error',
);

test.describe('Severity class filter', { tag: ['@search'] }, () => {
  test('filters by class and restores the filter from a saved search', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    const rows = searchPage.table.getRows();
    let savedSearchUrl = '';

    const expectErrorRows = async () => {
      await expect(searchPage.getTableError()).toHaveCount(0);
      await expect(rows).toHaveCount(errorRows.length, {
        timeout: QUERY_TIMEOUT,
      });
      for (const row of errorRows) {
        await expect(rows.filter({ hasText: row.body })).toHaveCount(1);
      }
      for (const row of numberWinsRows) {
        await expect(rows.filter({ hasText: row.body })).toHaveCount(0);
      }
      await expect(searchPage.getActiveFilterPill(FACET)).toHaveText(
        'Severity = ERROR',
      );
    };

    await test.step('Select the severity class source', async () => {
      await searchPage.goto();
      await searchPage.selectSource(SEVERITY_CLASS_LOGS_SOURCE_NAME);
      await searchPage.timePicker.selectRelativeTime('Last 1 days');
      await expect(rows).toHaveCount(SEVERITY_CLASS_ROWS.length, {
        timeout: QUERY_TIMEOUT,
      });
    });

    await test.step('Selecting ERROR keeps number and text matches', async () => {
      await searchPage.filters.openFilterGroup(FACET);
      await searchPage.filters.applyFilter(FACET, 'ERROR');
      await searchPage.submitButton.click();
      await expectErrorRows();
    });

    await test.step('Save the search', async () => {
      await searchPage.openSaveSearchModal();
      await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
        `Severity class filter ${Date.now()}`,
      );
      savedSearchUrl = page.url().split('?')[0];
    });

    await test.step('Reopening the saved search restores the filter', async () => {
      await searchPage.goto();
      await page.goto(savedSearchUrl);
      // The group opens itself when it has a selection; openFilterGroup toggles.
      await expect(
        searchPage.filters.getFilterCheckboxInput(FACET, 'ERROR'),
      ).toBeChecked({ timeout: QUERY_TIMEOUT });
      await expectErrorRows();
    });

    await test.step('A source without a severity number drops the filter', async () => {
      await searchPage.selectSource(DEFAULT_LOGS_SOURCE_NAME);
      await expect(searchPage.getDroppedFiltersToast()).toBeVisible({
        timeout: 10_000,
      });
      await expect(searchPage.filters.getFilterGroup(FACET)).toHaveCount(0);
      await expect(searchPage.getActiveFilterPill(FACET)).toHaveCount(0);
    });
  });
});
