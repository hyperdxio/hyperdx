import { AlertsPage } from '../page-objects/AlertsPage';
import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';

test.describe(
  'Alerts Functionality',
  { tag: ['@alerts', '@full-stack'] },
  () => {
    let alertsPage: AlertsPage;
    let searchPage: SearchPage;

    test.beforeEach(async ({ page }) => {
      alertsPage = new AlertsPage(page);
      searchPage = new SearchPage(page);
    });

    test('should load alerts page with empty state', async () => {
      await test.step('Navigate to alerts page', async () => {
        await alertsPage.goto();
      });

      await test.step('Verify alerts page loads', async () => {
        await expect(alertsPage.pageContainer).toBeVisible();
      });

      await test.step('Verify empty state message is shown', async () => {
        await expect(alertsPage.emptyStateMessage).toBeVisible();
        await expect(alertsPage.emptyStateMessage).toHaveText(
          'No alerts created yet',
        );
      });

      await test.step('Verify info banner about creating alerts', async () => {
        await expect(
          alertsPage.page.getByText('Alerts can be', { exact: false }),
        ).toBeVisible();
      });
    });

    test('should create alert from search page and manage it', async () => {
      test.setTimeout(90000);

      await test.step('Navigate to search page', async () => {
        await searchPage.goto();
      });

      await test.step('Verify alerts button is visible', async () => {
        await expect(alertsPage.searchPageAlertsButton).toBeVisible();
      });

      await test.step('Open alerts modal from search page', async () => {
        await alertsPage.openAlertsModalFromSearch();
        await expect(alertsPage.modal).toBeVisible();
      });

      await test.step('Fill in saved search name and create webhook', async () => {
        await alertsPage.fillSavedSearchName('E2E Alert Test Search');
        await alertsPage.createWebhook(
          'Generic',
          'E2E Test Webhook',
          'https://example.com/e2e-webhook',
        );
      });

      await test.step('Submit the alert form', async () => {
        await alertsPage.submitAlertForm();
        await expect(alertsPage.modal).toBeHidden({ timeout: 10000 });
      });

      await test.step('Verify redirected to saved search page', async () => {
        await searchPage.page.waitForURL(/\/search\//, { timeout: 10000 });
        await expect(searchPage.page).toHaveURL(/\/search\/.+/);
      });

      await test.step('Navigate to alerts page and verify alert exists', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();

        const alertCards = alertsPage.getAlertCards();
        await expect(alertCards).toHaveCount(1, { timeout: 10000 });
      });

      await test.step('Verify alert card displays correct information', async () => {
        const firstCard = alertsPage.getAlertCard(0);
        await expect(firstCard).toBeVisible();
        await expect(
          firstCard.getByText('E2E Alert Test Search'),
        ).toBeVisible();
        await expect(firstCard.getByText('Webhook')).toBeVisible();
      });

      await test.step('Click alert link to navigate to saved search', async () => {
        const alertLink = alertsPage.getAlertLink(0);
        await expect(alertLink).toBeVisible();
        await alertLink.click();
        await searchPage.page.waitForURL(/\/search\//, { timeout: 10000 });
      });

      await test.step('Verify search page loads with the saved search', async () => {
        await expect(searchPage.form).toBeVisible();
      });

      await test.step('Open alerts modal to see existing alert', async () => {
        await alertsPage.openAlertsModalFromSearch();
        await expect(alertsPage.modal).toBeVisible();

        await expect(
          alertsPage.modal.getByText('E2E Alert Test Search'),
        ).toBeVisible();
        await expect(
          alertsPage.modal.getByRole('tab', { name: 'Alert 1' }),
        ).toBeVisible();
        await expect(
          alertsPage.modal.getByRole('tab', { name: 'New Alert' }),
        ).toBeVisible();
      });

      await test.step('Select existing alert tab and delete it', async () => {
        await alertsPage.selectAlertTab(0);
        await expect(alertsPage.deleteButton).toBeVisible();
        await alertsPage.deleteAlertFromModal();
      });

      await test.step('Verify alert is removed from alerts page', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();

        const alertCards = alertsPage.getAlertCards();
        await expect(alertCards).toHaveCount(0, { timeout: 10000 });
        await expect(alertsPage.emptyStateMessage).toBeVisible();
      });
    });

    test('should create alert on existing saved search', async () => {
      test.setTimeout(90000);

      await test.step('Create a saved search first', async () => {
        await searchPage.goto();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.fillName(
          'E2E Saved Search for Alert',
        );
        await searchPage.savedSearchModal.submit();
        await searchPage.page.waitForURL(/\/search\//, { timeout: 10000 });
      });

      await test.step('Open alerts modal and create an alert', async () => {
        await alertsPage.openAlertsModalFromSearch();
        await expect(alertsPage.modal).toBeVisible();

        await expect(
          alertsPage.modal.getByText('E2E Saved Search for Alert'),
        ).toBeVisible();
      });

      await test.step('Create webhook and submit alert', async () => {
        await alertsPage.createWebhook(
          'Generic',
          'E2E Webhook for Saved Search',
          'https://example.com/e2e-saved-search-webhook',
        );

        await expect(alertsPage.submitButton).toHaveText('Create Alert');
        await alertsPage.submitAlertForm();
        await expect(alertsPage.modal).toBeHidden({ timeout: 10000 });
      });

      await test.step('Verify alert appears on alerts page', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();

        const alertCards = alertsPage.getAlertCards();
        await expect(alertCards).toHaveCount(1, { timeout: 10000 });

        const firstCard = alertsPage.getAlertCard(0);
        await expect(
          firstCard.getByText('E2E Saved Search for Alert'),
        ).toBeVisible();
      });
    });
  },
);
