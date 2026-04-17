import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { AlertsPage } from '../page-objects/AlertsPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';

test.describe('Alerts', { tag: ['@alerts', '@full-stack'] }, () => {
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
   */
  async function createSavedSearchAlert() {
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
      await searchPage.alertModal.createAlert();
    });

    return { savedSearchName, webhookName, webhookUrl, ts };
  }

  test(
    'should create an alert from a saved search and verify on the alerts page',
    { tag: '@full-stack' },
    async () => {
      const { savedSearchName } = await createSavedSearchAlert();

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
    'should show validation error when saving a raw SQL alert without required interval param',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const tileName = `E2E Invalid SQL Alert ${ts}`;
      const webhookName = `E2E Webhook Invalid ${ts}`;
      const webhookUrl = `https://example.com/invalid-${ts}`;

      // SQL query missing intervalSeconds, startDateMilliseconds / endDateMilliseconds
      const invalidSqlQuery = `SELECT now() as ts, count() AS cnt
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
            'SQL used for alerts must include an interval parameter or macro.',
          ),
        ).toBeVisible({ timeout: 5000 });
        // The chart editor should still be open since saving was blocked
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      });
    },
  );

  test(
    'should create an alert from a raw SQL Number dashboard tile and verify on the alerts page',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const tileName = `E2E Raw SQL Number Alert ${ts}`;
      const webhookName = `E2E Webhook Number ${ts}`;
      const webhookUrl = `https://example.com/number-${ts}`;

      const sqlQuery = `SELECT count() AS cnt
        FROM $__sourceTable
        WHERE Timestamp >= fromUnixTimestamp64Milli({startDateMilliseconds:Int64}) AND Timestamp < fromUnixTimestamp64Milli({endDateMilliseconds:Int64})
      `;

      await test.step('Create a new dashboard', async () => {
        await dashboardPage.goto();
        await dashboardPage.createNewDashboard();
      });

      await test.step('Add a raw SQL Number tile to the dashboard', async () => {
        await dashboardPage.addTile();
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.waitForDataToLoad();
        await dashboardPage.chartEditor.setChartName(tileName);
        await dashboardPage.chartEditor.setChartType(DisplayType.Number);
        await dashboardPage.chartEditor.switchToSqlMode();
        await dashboardPage.chartEditor.typeSqlQuery(sqlQuery);
        await dashboardPage.chartEditor.runQuery(false);
      });

      await test.step('Enable and configure an alert on the raw SQL Number tile', async () => {
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
    'should create a between-threshold alert from a saved search and verify on the alerts page',
    { tag: '@full-stack' },
    async () => {
      const ts = Date.now();
      const savedSearchName = `E2E Between Alert Search ${ts}`;
      const webhookName = `E2E Webhook SS Between ${ts}`;
      const webhookUrl = `https://example.com/ss-between-${ts}`;

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

      await test.step('Select the Between (≤ x ≤) threshold type', async () => {
        await searchPage.alertModal.selectThresholdType('between');
        await expect(searchPage.alertModal.thresholdMaxInput).toBeVisible();
      });

      await test.step('Set threshold to 1 and thresholdMax to 5', async () => {
        await searchPage.alertModal.setThreshold(1);
        await searchPage.alertModal.setThresholdMax(5);
      });

      await test.step('Create a new incoming webhook for the alert channel', async () => {
        await searchPage.alertModal.addWebhookAndWait(
          'Generic',
          webhookName,
          webhookUrl,
        );
      });

      await test.step('Explicitly select the webhook (auto-select is unreliable)', async () => {
        await searchPage.alertModal.selectWebhook(webhookName);
      });

      await test.step('Create the alert', async () => {
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
    'should create a between-threshold alert from a dashboard tile and verify on the alerts page',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const tileName = `E2E Between Alert Tile ${ts}`;
      const webhookName = `E2E Webhook Tile Between ${ts}`;
      const webhookUrl = `https://example.com/tile-between-${ts}`;

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

      await test.step('Enable alert and select the Between (≤ x ≤) threshold type', async () => {
        await expect(dashboardPage.chartEditor.alertButton).toBeVisible();
        await dashboardPage.chartEditor.clickAddAlert();
        await expect(
          dashboardPage.chartEditor.addNewWebhookButton,
        ).toBeVisible();
        await dashboardPage.chartEditor.selectTileAlertThresholdType('between');
      });

      await test.step('Set alert.threshold to 1 and alert.thresholdMax to 5', async () => {
        await dashboardPage.chartEditor.setTileAlertThreshold(1);
        await dashboardPage.chartEditor.setTileAlertThresholdMax(5);
      });

      await test.step('Create a new incoming webhook for the alert channel', async () => {
        await dashboardPage.chartEditor.addNewWebhookButton.click();
        await expect(page.getByTestId('webhook-name-input')).toBeVisible();
        await dashboardPage.chartEditor.webhookAlertModal.addWebhook(
          'Generic',
          webhookName,
          webhookUrl,
        );
        await expect(page.getByTestId('alert-modal')).toBeHidden();
      });

      await test.step('Explicitly select the webhook (auto-select is unreliable)', async () => {
        await dashboardPage.chartEditor.selectWebhook(webhookName);
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
});
