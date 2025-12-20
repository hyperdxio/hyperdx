import { SessionsPage } from '../page-objects/SessionsPage';
import { expect, test } from '../utils/base-test';

test.describe('Client Sessions Functionality', { tag: ['@sessions'] }, () => {
  let sessionsPage: SessionsPage;

  test.beforeEach(async ({ page }) => {
    sessionsPage = new SessionsPage(page);
  });

  test('should load sessions page', async () => {
    await test.step('Navigate to sessions page', async () => {
      await sessionsPage.goto();
    });

    await test.step('Verify sessions page components are present', async () => {
      // Use web-first assertions instead of synchronous expect
      await expect(sessionsPage.form).toBeVisible();
      await expect(sessionsPage.dataSource).toBeVisible();

      // Verify Mantine select input is present
      const selectInput = sessionsPage.page.locator('.mantine-Select-input');
      await expect(selectInput).toBeVisible();
    });
  });

  test('should interact with session cards', async () => {
    await test.step('Navigate to sessions page and wait for load', async () => {
      // First go to search page to trigger onboarding modal handling
      await sessionsPage.page.goto('/search');

      // Then navigate to sessions page
      await sessionsPage.goto();
    });

    await test.step('Find and interact with session cards', async () => {
      const firstSession = sessionsPage.getFirstSessionCard();
      await expect(sessionsPage.dataSource).toBeVisible();
      await expect(firstSession).toBeVisible();
      await sessionsPage.openFirstSession();
    });
  });
});
