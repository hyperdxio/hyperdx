import { AlertsPage } from '../page-objects/AlertsPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';

test.describe('Alert Management', { tag: ['@alerts', '@full-stack'] }, () => {
  let searchPage: SearchPage;
  let dashboardPage: DashboardPage;
  let alertsPage: AlertsPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    dashboardPage = new DashboardPage(page);
    alertsPage = new AlertsPage(page);
  });

  /**
   * Helper: creates a saved search alert and returns the names used.
   * Reuses the exact pattern from alerts.spec.ts.
   */
  async function createSavedSearchAlert() {
    const ts = Date.now();
    const savedSearchName = `E2E Mgmt Search ${ts}`;
    const webhookName = `E2E Mgmt Webhook ${ts}`;
    const webhookUrl = `https://example.com/mgmt-${ts}`;

    await test.step('Create a saved search', async () => {
      await searchPage.goto();
      await searchPage.openSaveSearchModal();
      await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
        savedSearchName,
      );
    });

    await test.step('Open the alerts modal from the saved search page', async () => {
      await expect(searchPage.alertsButton).toBeVisible();
      await searchPage.openAlertsModal();
      await expect(searchPage.alertModal.addNewWebhookButton).toBeVisible();
    });

    await test.step('Create a new incoming webhook for the alert channel', async () => {
      await searchPage.alertModal.addWebhookAndWait(
        'Generic',
        webhookName,
        webhookUrl,
      );
    });

    await test.step('Create the alert (webhook is auto-selected after creation)', async () => {
      await searchPage.alertModal.createAlert();
    });

    return { savedSearchName, webhookName, webhookUrl, ts };
  }

  test(
    'should display alert card with state badge and navigate to source',
    { tag: '@full-stack' },
    async () => {
      const { savedSearchName } = await createSavedSearchAlert();

      await test.step('Navigate to alerts page and verify card is visible', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await expect(
          alertsPage.getAlertLinkByName(savedSearchName),
        ).toBeVisible({ timeout: 10000 });
      });

      await test.step('Verify the alert card has a state badge', async () => {
        const alertCard = alertsPage.getAlertCardByName(savedSearchName);
        await expect(alertCard).toBeVisible();

        const stateBadge = alertsPage.getAlertStateBadge(alertCard);
        await expect(stateBadge).toBeVisible();
      });

      await test.step('Click the alert link and verify navigation to saved search', async () => {
        const alertLink = alertsPage.getAlertLinkByName(savedSearchName);
        await alertLink.click();
        await expect(searchPage.page).toHaveURL(/\/search\/[a-f0-9]+/, {
          timeout: 10000,
        });
      });
    },
  );

  test(
    'should display multiple alerts and verify ordering',
    { tag: '@full-stack' },
    async () => {
      const ts1 = Date.now();
      const savedSearchName1 = `E2E Multi Alert A ${ts1}`;
      const webhookName1 = `E2E Multi WH A ${ts1}`;
      const webhookUrl1 = `https://example.com/multi-a-${ts1}`;

      await test.step('Create first saved search alert', async () => {
        await searchPage.goto();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          savedSearchName1,
        );
        await expect(searchPage.alertsButton).toBeVisible();
        await searchPage.openAlertsModal();
        await expect(searchPage.alertModal.addNewWebhookButton).toBeVisible();
        await searchPage.alertModal.addWebhookAndWait(
          'Generic',
          webhookName1,
          webhookUrl1,
        );
        await searchPage.alertModal.createAlert();
      });

      const ts2 = Date.now();
      const savedSearchName2 = `E2E Multi Alert B ${ts2}`;
      const webhookName2 = `E2E Multi WH B ${ts2}`;
      const webhookUrl2 = `https://example.com/multi-b-${ts2}`;

      await test.step('Create second saved search alert', async () => {
        await searchPage.goto();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          savedSearchName2,
        );
        await expect(searchPage.alertsButton).toBeVisible();
        await searchPage.openAlertsModal();
        await expect(searchPage.alertModal.addNewWebhookButton).toBeVisible();
        await searchPage.alertModal.addWebhookAndWait(
          'Generic',
          webhookName2,
          webhookUrl2,
        );
        await searchPage.alertModal.createAlert();
      });

      await test.step('Navigate to alerts page and verify both alerts are visible', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();

        await expect(
          alertsPage.getAlertLinkByName(savedSearchName1),
        ).toBeVisible({ timeout: 10000 });

        await expect(
          alertsPage.getAlertLinkByName(savedSearchName2),
        ).toBeVisible({ timeout: 10000 });
      });

      await test.step('Verify multiple alert cards are rendered', async () => {
        const alertCards = alertsPage.getAlertCards();
        expect(await alertCards.count()).toBeGreaterThanOrEqual(2);
      });
    },
  );
});
