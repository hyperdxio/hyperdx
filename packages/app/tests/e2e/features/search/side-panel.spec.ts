import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Side Panel Navigation', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('should close side panel with Escape key', async () => {
    await test.step('Open side panel', async () => {
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible();
    });

    await test.step('Press Escape and verify panel is hidden', async () => {
      await searchPage.page.keyboard.press('Escape');
      await expect(searchPage.sidePanel.container).toBeHidden();
    });
  });
});
