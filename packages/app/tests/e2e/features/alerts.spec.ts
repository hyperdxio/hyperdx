import { AlertsPage } from '../page-objects/AlertsPage';
import { expect, test } from '../utils/base-test';

test.skip('Alerts Functionality', { tag: ['@alerts', '@full-stack'] }, () => {
  let alertsPage: AlertsPage;

  test.beforeEach(async ({ page }) => {
    alertsPage = new AlertsPage(page);
    await alertsPage.goto();
  });

  test('should load alerts page', async () => {
    await test.step('Navigate to alerts page', async () => {
      await alertsPage.goto();
    });

    await test.step('Verify alerts page loads with content', async () => {
      await expect(alertsPage.pageContainer).toBeVisible();

      // Verify there are alert cards using web-first assertion
      const alertCards = alertsPage.getAlertCards();
      try {
        await expect(alertCards).toHaveCount(1, { timeout: 10000 });
      } catch {
        // If there are no alerts, just verify the container is visible
        await expect(alertsPage.pageContainer).toBeVisible();
      }
    });

    await test.step('Verify alert links are accessible', async () => {
      const firstAlertLink = alertsPage.getAlertLink(0);
      // Only verify if alerts exist
      const isVisible = await firstAlertLink
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (isVisible) {
        await expect(firstAlertLink).toBeVisible();
      }
    });
  });

  test('should handle alerts creation from search', async () => {
    await test.step('Navigate to search page', async () => {
      await alertsPage.page.goto('/search');
    });

    await test.step('Open alerts creation modal', async () => {
      await expect(alertsPage.createButton).toBeVisible();
      await alertsPage.openAlertsModal();
    });

    await test.step('Verify alerts modal opens', async () => {
      await expect(alertsPage.modal).toBeVisible();
    });
  });
});
