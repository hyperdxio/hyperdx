import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';

test.describe('Sources Functionality', () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('should open source settings menu', async () => {
    // Click source settings menu
    const sourceSettingsMenu = searchPage.page.locator(
      '[data-testid="source-settings-menu"]',
    );
    await sourceSettingsMenu.click();

    // Verify create new source menu item is visible
    const createNewSourceMenuItem = searchPage.page.locator(
      '[data-testid="create-new-source-menu-item"]',
    );
    await expect(createNewSourceMenuItem).toBeVisible();

    // Verify edit source menu items are visible
    const editSourceMenuItems = searchPage.page.locator(
      '[data-testid="edit-source-menu-item"], [data-testid="edit-sources-menu-item"]',
    );
    await expect(editSourceMenuItems.first()).toBeVisible();
  });
});
