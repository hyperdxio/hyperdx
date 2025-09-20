import { expect, test } from '../utils/base-test';

test.describe('Client Sessions Functionality', { tag: ['@sessions'] }, () => {
  test('should load sessions page', async ({ page }) => {
    await test.step('Navigate to sessions page', async () => {
      await page.goto('/sessions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    });

    await test.step('Verify sessions page components are present', async () => {
      await page.waitForTimeout(1000);

      const selectors = [
        '[data-testid="sessions-search-form"]',
        'input[placeholder="Data Source"]',
        '.mantine-Select-input',
      ];

      for (const selector of selectors) {
        expect(page.locator(selector)).toBeVisible();
      }
    });
  });

  test('should interact with session cards', async ({ page }) => {
    await test.step('Navigate to sessions page and wait for load', async () => {
      // First go to search page to trigger onboarding modal handling
      await page.goto('/search');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Then navigate to sessions page
      await page.goto('/sessions');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    });

    await test.step('Find and interact with session cards', async () => {
      const sessionCards = page.locator('[data-testid^="session-card-"]');
      const sessionCount = await sessionCards.count();

      if (sessionCount > 0) {
        const firstSession = sessionCards.first();
        await expect(firstSession).toBeVisible();
        await firstSession.click();
        await page.waitForTimeout(1000);
      } else {
        // If no session cards, at least verify the page structure is correct
        await expect(
          page.locator('input[placeholder="Data Source"]'),
        ).toBeVisible();
      }
    });
  });
});
