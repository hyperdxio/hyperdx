import { AlertsPage } from '../page-objects/AlertsPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';

test.describe('Alert Creation', { tag: ['@alerts', '@full-stack'] }, () => {
  let searchPage: SearchPage;
  let dashboardPage: DashboardPage;
  let alertsPage: AlertsPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    dashboardPage = new DashboardPage(page);
    alertsPage = new AlertsPage(page);
  });

  test(
    'should create an alert from a saved search and verify on the alerts page',
    { tag: '@full-stack' },
    async () => {
      const ts = Date.now();
      const savedSearchName = `E2E Alert Search ${ts}`;
      const webhookName = `E2E Webhook SS ${ts}`;
      const webhookUrl = `https://example.com/ss-${ts}`;

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
        // The webhook is automatically selected in the form after webhook creation
        // (handleWebhookCreated calls field.onChange(webhookId) before closing modal)
        await searchPage.alertModal.createAlert();
      });

      await test.step('Verify the alert is visible on the alerts page', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await expect(
          alertsPage.pageContainer
            .getByRole('link')
            .filter({ hasText: savedSearchName }),
        ).toBeVisible({ timeout: 10000 });
      });
    },
  );

  test(
    'should create an alert from a dashboard tile and verify on the alerts page',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const tileName = `E2E Alert Tile ${ts}`;
      const webhookName = `E2E Webhook Tile ${ts}`;
      const webhookUrl = `https://example.com/tile-${ts}`;

      await test.step('Create a new dashboard', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
      });

      await test.step('Add a tile to the dashboard', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.setChartName(tileName);
        await dashboardPage.chartEditor.runQuery();
      });

      await test.step('Enable and configure an alert on the tile', async () => {
        await expect(dashboardPage.chartEditor.alertButton).toBeVisible();
        await dashboardPage.chartEditor.clickAddAlert();
        await expect(
          dashboardPage.chartEditor.addNewWebhookButton,
        ).toBeVisible();
        await dashboardPage.chartEditor.addNewWebhookButton.click();
        // Verify webhook form opened by checking for its inner input
        await expect(page.getByTestId('webhook-name-input')).toBeVisible();
        await dashboardPage.chartEditor.webhookAlertModal.addWebhook(
          'Generic',
          webhookName,
          webhookUrl,
        );
        await expect(page.getByTestId('alert-modal')).toBeHidden();
        // The webhook is automatically selected in the form after creation
        // (handleWebhookCreated calls field.onChange(webhookId) before closing modal)
      });

      await test.step('Save the tile with the alert configured', async () => {
        await dashboardPage.chartEditor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      await test.step('Verify the alert is visible on the alerts page', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await expect(
          alertsPage.pageContainer
            .getByRole('link')
            .filter({ hasText: tileName }),
        ).toBeVisible({ timeout: 10000 });
      });
    },
  );

  test(
    'should create a rate-of-change alert from a saved search',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const savedSearchName = `E2E RoC Alert ${ts}`;
      const webhookName = `E2E Webhook RoC ${ts}`;
      const webhookUrl = `https://example.com/roc-${ts}`;

      await test.step('Create a saved search', async () => {
        await searchPage.goto();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          savedSearchName,
        );
      });

      await test.step('Open the alerts modal', async () => {
        await expect(searchPage.alertsButton).toBeVisible();
        await searchPage.openAlertsModal();
        await expect(searchPage.alertModal.addNewWebhookButton).toBeVisible();
      });

      await test.step('Select Rate of Change condition', async () => {
        await page
          .getByTestId('condition-type-select')
          .selectOption('rate_of_change');
        await page.getByTestId('change-type-select').selectOption('percentage');
      });

      await test.step('Create webhook and alert', async () => {
        await searchPage.alertModal.addWebhookAndWait(
          'Generic',
          webhookName,
          webhookUrl,
        );
        await searchPage.alertModal.createAlert();
      });

      await test.step('Verify the alert on the alerts page shows change info', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await expect(
          alertsPage.pageContainer
            .getByRole('link')
            .filter({ hasText: savedSearchName }),
        ).toBeVisible({ timeout: 10000 });
        await expect(
          alertsPage.pageContainer.getByText('Rate of Change').first(),
        ).toBeVisible();
      });
    },
  );

  test(
    'should create a rate-of-change alert from a dashboard tile',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const tileName = `E2E RoC Tile ${ts}`;
      const webhookName = `E2E Webhook RoC Tile ${ts}`;
      const webhookUrl = `https://example.com/roc-tile-${ts}`;

      await test.step('Create a new dashboard', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
      });

      await test.step('Add a tile', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.setChartName(tileName);
        await dashboardPage.chartEditor.runQuery();
      });

      await test.step('Enable alert and select rate-of-change', async () => {
        await expect(dashboardPage.chartEditor.alertButton).toBeVisible();
        await dashboardPage.chartEditor.clickAddAlert();

        await page
          .getByTestId('tile-condition-type-select')
          .selectOption('rate_of_change');
        await page
          .getByTestId('tile-change-type-select')
          .selectOption('absolute');

        await dashboardPage.chartEditor.addNewWebhookButton.click();
        await expect(page.getByTestId('webhook-name-input')).toBeVisible();
        await dashboardPage.chartEditor.webhookAlertModal.addWebhook(
          'Generic',
          webhookName,
          webhookUrl,
        );
        await expect(page.getByTestId('alert-modal')).toBeHidden();
      });

      await test.step('Save the tile', async () => {
        await dashboardPage.chartEditor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      await test.step('Verify alert on alerts page', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await expect(
          alertsPage.pageContainer
            .getByRole('link')
            .filter({ hasText: tileName }),
        ).toBeVisible({ timeout: 10000 });
      });
    },
  );
});
