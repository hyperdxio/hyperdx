import { expect, test } from '../../utils/base-test';

test.skip('Saved Search Functionality', { tag: '@full-server' }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
  });

  test(
    'should handle save search workflow',
    { tag: '@full-server' },
    async ({ page }) => {
      const saveButton = page.locator('[data-testid="save-search-button"]');
      await expect(saveButton).toBeVisible();
      await saveButton.scrollIntoViewIfNeeded();
      await saveButton.click({ force: true });
      await page.waitForTimeout(1000);
      await expect(
        page.locator('[data-testid="save-search-modal"]'),
      ).toBeVisible();
    },
  );
});
