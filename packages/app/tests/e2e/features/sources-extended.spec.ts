import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../utils/constants';

test.describe('Sources Extended', { tag: ['@sources'] }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('should list available sources in the dropdown', async () => {
    await searchPage.sourceDropdown.click();

    // Verify log and trace sources exist via page object
    await expect(
      searchPage.sourceOptions.filter({
        hasText: DEFAULT_LOGS_SOURCE_NAME,
      }),
    ).toBeVisible();
    await expect(
      searchPage.sourceOptions.filter({
        hasText: DEFAULT_TRACES_SOURCE_NAME,
      }),
    ).toBeVisible();
  });

  test('should switch between different source types and see results', async () => {
    // Logs source is selected by default after goto(), verify rows exist
    await expect(searchPage.table.getRows().first()).toBeVisible();

    // Switch to traces source
    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await searchPage.table.waitForRowsToPopulate();

    // Verify traces table also has rows
    await expect(searchPage.table.getRows().first()).toBeVisible();
  });

  test('should navigate to team page when editing sources', async () => {
    await searchPage.openEditSourceModal();

    // Edit Sources navigates to the team settings page
    await expect(searchPage.page).toHaveURL(/\/team/, { timeout: 10000 });
  });

  test('should show Create New Source option in dropdown', async () => {
    await searchPage.sourceDropdown.click();

    await expect(searchPage.createNewSourceItem).toBeVisible();
  });
});
