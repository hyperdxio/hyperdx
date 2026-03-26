import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search Table Features', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
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
