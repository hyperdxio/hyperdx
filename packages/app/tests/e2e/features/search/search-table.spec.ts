import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search Table Features', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('should switch between SQL and Lucene query modes', async () => {
    await test.step('Verify Lucene mode is default with search results', async () => {
      await expect(searchPage.table.firstRow).toBeVisible();
    });

    await test.step('Switch to SQL mode and verify editor appears', async () => {
      await searchPage.switchToSQLMode();
      await expect(searchPage.sqlEditor).toBeVisible();
    });

    await test.step('Switch back to Lucene and search', async () => {
      await searchPage.switchToLuceneMode();
      await searchPage.performSearch('Order');
      await expect(searchPage.table.firstRow).toBeVisible();
    });
  });

  test('should display custom SELECT columns in results', async () => {
    await test.step('Set custom SELECT columns', async () => {
      await searchPage.setCustomSELECT(
        'Timestamp, ServiceName, Body as message, SeverityText',
      );
    });

    await test.step('Submit search and verify results', async () => {
      await searchPage.submitEmptySearch();
      await expect(searchPage.table.firstRow).toBeVisible();
    });

    await test.step('Verify SELECT editor retains custom columns', async () => {
      const selectEditor = searchPage.getSELECTEditor();
      await expect(selectEditor).toBeVisible();
      const selectValue = await selectEditor.textContent();
      expect(selectValue).toContain('Body as message');
      expect(selectValue).toContain('SeverityText');
    });
  });

  test('should handle empty search results gracefully', async () => {
    await test.step('Search for nonexistent term', async () => {
      // Use fill + click instead of performSearch which waits for rows
      await searchPage.input.fill('xyznonexistent12345uniqueterm');
      await searchPage.submitButton.click();
    });

    await test.step('Verify no results message appears', async () => {
      const noResults = searchPage.page.getByTestId('db-row-table-no-results');
      await expect(noResults).toBeVisible({ timeout: 15000 });
    });
  });
});
