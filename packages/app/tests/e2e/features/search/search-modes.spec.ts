import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search Query Modes', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('should perform Lucene search with field syntax', async () => {
    await test.step('Search with Lucene field syntax', async () => {
      await searchPage.performSearch('ServiceName:"api-server"');
    });

    await test.step('Verify results appear', async () => {
      await expect(searchPage.table.firstRow).toBeVisible();
    });
  });

  test('should switch to SQL mode and see SQL interface', async () => {
    await test.step('Switch to SQL mode', async () => {
      await searchPage.switchToSQLMode();
    });

    await test.step('Verify SQL mode is active by checking for SQL editor', async () => {
      await expect(searchPage.sqlEditor).toBeVisible();
    });
  });

  test('should preserve query mode across page interactions', async () => {
    await test.step('Verify default is Lucene mode', async () => {
      await expect(searchPage.input).toBeVisible();
    });

    await test.step('Switch to SQL mode', async () => {
      await searchPage.switchToSQLMode();
    });

    await test.step('Verify SQL editor is shown', async () => {
      await expect(searchPage.sqlEditor).toBeVisible();
    });

    await test.step('Switch back to Lucene mode', async () => {
      await searchPage.switchToLuceneMode();
    });

    await test.step('Verify Lucene input is shown again', async () => {
      await expect(searchPage.input).toBeVisible();
    });
  });
});
