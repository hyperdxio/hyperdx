import { expect, test } from '../utils/base-test';

test.describe('Sources Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
  });

  test('should open source settings menu', async ({ page }) => {
    await page.click('[data-testid="source-settings-menu"]');
    await expect(
      page.locator('[data-testid="create-new-source-menu-item"]'),
    ).toBeVisible();

    const editSourceMenuItems = page.locator(
      '[data-testid="edit-source-menu-item"], [data-testid="edit-sources-menu-item"]',
    );
    await expect(editSourceMenuItems.first()).toBeVisible();
  });
});
