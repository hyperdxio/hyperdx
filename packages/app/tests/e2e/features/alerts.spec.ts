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
    'should create an alert from a raw SQL dashboard tile and verify on the alerts page',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const tileName = `E2E Raw SQL Alert ${ts}`;
      const webhookName = `E2E Webhook RawSQL ${ts}`;
      const webhookUrl = `https://example.com/rawsql-${ts}`;

      const sqlQuery = `SELECT toStartOfInterval(Timestamp, INTERVAL {intervalSeconds:Int64} second) AS ts, count() AS cnt
        FROM $__sourceTable
        WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
        GROUP BY ts ORDER BY ts
      `;

      await test.step('Create a new dashboard', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
      });

      await test.step('Add a raw SQL tile to the dashboard', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.setChartName(tileName);
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.typeSqlQuery(sqlQuery);
        await dashboardPage.chartEditor.runQuery();
      });

      await test.step('Enable and configure an alert on the raw SQL tile', async () => {
        await expect(dashboardPage.chartEditor.alertButton).toBeVisible();
        await dashboardPage.chartEditor.clickAddAlert();
        await expect(
          dashboardPage.chartEditor.addNewWebhookButton,
        ).toBeVisible();
        await dashboardPage.chartEditor.addNewWebhookButton.click();
        await expect(page.getByTestId('webhook-name-input')).toBeVisible();
        await dashboardPage.chartEditor.webhookAlertModal.addWebhook(
          'Generic',
          webhookName,
          webhookUrl,
        );
        await expect(page.getByTestId('alert-modal')).toBeHidden();
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
    'should show validation error when saving a raw SQL alert without required time filters',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const tileName = `E2E Invalid SQL Alert ${ts}`;
      const webhookName = `E2E Webhook Invalid ${ts}`;
      const webhookUrl = `https://example.com/invalid-${ts}`;

      // SQL query missing startDateMilliseconds / endDateMilliseconds
      const invalidSqlQuery = `SELECT toStartOfInterval(Timestamp, INTERVAL {intervalSeconds:Int64} second) AS ts, count() AS cnt
        FROM $__sourceTable
        GROUP BY ts ORDER BY ts
      `;

      await test.step('Create a new dashboard', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
      });

      await test.step('Add a raw SQL tile with an invalid query', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.setChartName(tileName);
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.typeSqlQuery(invalidSqlQuery);
        await dashboardPage.chartEditor.runQuery();
      });

      await test.step('Enable and configure an alert', async () => {
        await expect(dashboardPage.chartEditor.alertButton).toBeVisible();
        await dashboardPage.chartEditor.clickAddAlert();
        await expect(
          dashboardPage.chartEditor.addNewWebhookButton,
        ).toBeVisible();
        await dashboardPage.chartEditor.addNewWebhookButton.click();
        await expect(page.getByTestId('webhook-name-input')).toBeVisible();
        await dashboardPage.chartEditor.webhookAlertModal.addWebhook(
          'Generic',
          webhookName,
          webhookUrl,
        );
        await expect(page.getByTestId('alert-modal')).toBeHidden();
      });

      await test.step('Attempt to save and verify error notification', async () => {
        await dashboardPage.chartEditor.saveBtn.click();
        await expect(
          page.getByText(
            'Raw SQL alert queries must include time filters and interval parameters',
          ),
        ).toBeVisible({ timeout: 5000 });
        // The chart editor should still be open since saving was blocked
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      });
    },
  );
});
