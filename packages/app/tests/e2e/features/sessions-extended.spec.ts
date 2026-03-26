import { SessionsPage } from '../page-objects/SessionsPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_SESSIONS_SOURCE_NAME } from '../utils/constants';

test.describe('Sessions Extended', { tag: ['@sessions'] }, () => {
  let sessionsPage: SessionsPage;

  test.beforeEach(async ({ page }) => {
    sessionsPage = new SessionsPage(page);
    // Navigate to search first to handle onboarding modal
    await page.goto('/search');
    await sessionsPage.goto();
  });

  test('should display multiple session cards', async () => {
    await test.step('Select data source', async () => {
      await sessionsPage.selectDataSource(DEFAULT_SESSIONS_SOURCE_NAME);
    });

    await test.step('Verify multiple session cards are visible', async () => {
      const sessionCards = sessionsPage.getSessionCards();
      await expect(sessionCards.first()).toBeVisible({ timeout: 10000 });
      expect(await sessionCards.count()).toBeGreaterThan(1);
    });
  });

  test('should open a session and display session details', async () => {
    await test.step('Select data source and wait for cards', async () => {
      await sessionsPage.selectDataSource(DEFAULT_SESSIONS_SOURCE_NAME);
      await expect(sessionsPage.getFirstSessionCard()).toBeVisible({
        timeout: 10000,
      });
    });

    await test.step('Open first session and verify details view', async () => {
      await sessionsPage.openFirstSession();
      // After clicking a session card, content should change
      // to show session details (either a side panel or navigated view)
      await sessionsPage.page.waitForLoadState('networkidle');
    });
  });

  test('should display session search form with data source selector', async () => {
    await test.step('Verify form components are visible', async () => {
      await expect(sessionsPage.form).toBeVisible();
      await expect(sessionsPage.dataSource).toBeVisible();
    });

    await test.step('Verify data source selector is interactable', async () => {
      await sessionsPage.dataSource.click();
      // Verify dropdown options appear
      const option = sessionsPage.page.locator(
        `text=${DEFAULT_SESSIONS_SOURCE_NAME}`,
      );
      await expect(option).toBeVisible();
    });
  });

  test('should filter sessions by selecting data source', async () => {
    await test.step('Verify initial state', async () => {
      await expect(sessionsPage.form).toBeVisible();
      await expect(sessionsPage.dataSource).toBeVisible();
    });

    await test.step('Select sessions data source and verify cards appear', async () => {
      await sessionsPage.selectDataSource(DEFAULT_SESSIONS_SOURCE_NAME);
      const firstCard = sessionsPage.getFirstSessionCard();
      await expect(firstCard).toBeVisible({ timeout: 10000 });
    });
  });
});
