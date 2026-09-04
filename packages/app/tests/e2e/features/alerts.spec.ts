import path from 'path';
import { DisplayType } from '@hyperdx/common-utils/dist/types';

import { SEEDED_ERROR_ALERT } from '../global-setup-fullstack';
import { AlertsPage } from '../page-objects/AlertsPage';
import { DashboardPage } from '../page-objects/DashboardPage';
import { SearchPage } from '../page-objects/SearchPage';
import { getApiUrl, getSources } from '../utils/api-helpers';
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
        await alertsPage.filterToAlert(savedSearchName);
        await expect(
          alertsPage.pageContainer
            .getByRole('link')
            .filter({ hasText: savedSearchName }),
        ).toBeVisible({ timeout: 10000 });
        // The provider models saved-search alerts, so this one is offered for
        // import.
        await alertsPage.openRowMenu(
          alertsPage.getAlertCardByName(savedSearchName),
        );
        await expect(alertsPage.terraformMenuItem).toBeVisible();
      });
    },
  );

  test(
    'should create and update a saved-search alert with a custom display name and tags',
    { tag: '@full-stack' },
    async () => {
      // Two round trips through the alert detail page, which dev mode compiles
      // on first hit.
      test.setTimeout(120000);
      const ts = Date.now();
      const savedSearchName = `E2E Named Alert Search ${ts}`;
      const displayName = `E2E Custom Alert Name ${ts}`;
      const tag = `e2e-tag-${ts}`;
      const updatedDisplayName = `E2E Renamed Alert ${ts}`;
      const updatedTag = `e2e-renamed-tag-${ts}`;
      const webhookName = `E2E Webhook Named ${ts}`;
      const webhookUrl = `https://example.com/named-${ts}`;

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

      await test.step('Set a custom display name and tag', async () => {
        await searchPage.alertModal.setDisplayName(displayName);
        await searchPage.alertModal.addTag(tag);
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

      await test.step('The alerts page finds it by its custom name and tag', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await alertsPage.filterToAlert(displayName);

        const card = alertsPage.getAlertCardByName(displayName);
        await expect(card).toBeVisible({ timeout: 10000 });
        await expect(card.getByText(tag)).toBeVisible();
      });

      await test.step('The saved search name no longer surfaces it', async () => {
        await alertsPage.searchByName(savedSearchName);
        await expect(
          alertsPage.getAlertCardByName(savedSearchName),
        ).toHaveCount(0);
      });

      await test.step('The detail page shows the custom name and tag', async () => {
        await alertsPage.filterToAlert(displayName);
        await alertsPage.openDetails(
          alertsPage.getAlertCardByName(displayName),
        );
        await expect(alertsPage.detailName).toHaveText(displayName);
        await expect(alertsPage.detailTags).toContainText(tag);
      });

      await test.step('Rename and retag the alert from the saved search page', async () => {
        await alertsPage.detailSourceLink.click();
        await alertsPage.page.waitForURL(/\/search\/[a-f0-9]{24}/);
        await expect(searchPage.alertsButton).toBeVisible();
        await searchPage.openAlertsModal();
        await searchPage.alertModal.selectExistingAlertTab(0);
        await searchPage.alertModal.setDisplayName(updatedDisplayName);
        await searchPage.alertModal.removeTag(tag);
        await searchPage.alertModal.addTag(updatedTag);
        await searchPage.alertModal.saveAlert();
      });

      await test.step('The alerts page shows the updated name and tag', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await alertsPage.filterToAlert(updatedDisplayName);

        const card = alertsPage.getAlertCardByName(updatedDisplayName);
        await expect(card).toBeVisible({ timeout: 10000 });
        await expect(card.getByText(updatedTag)).toBeVisible();
        await expect(card.getByText(tag, { exact: true })).toHaveCount(0);

        await alertsPage.searchByName(displayName);
        await expect(alertsPage.getAlertCardByName(displayName)).toHaveCount(0);
      });

      await test.step('The detail page shows the updated name and tag', async () => {
        await alertsPage.filterToAlert(updatedDisplayName);
        await alertsPage.openDetails(
          alertsPage.getAlertCardByName(updatedDisplayName),
        );
        await expect(alertsPage.detailName).toHaveText(updatedDisplayName);
        await expect(alertsPage.detailTags).toContainText(updatedTag);
        await expect(alertsPage.detailTags).not.toContainText(tag);
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
        await alertsPage.filterToAlert(tileName);
        await expect(
          alertsPage.pageContainer
            .getByRole('link')
            .filter({ hasText: tileName }),
        ).toBeVisible({ timeout: 10000 });
        // Tile alerts have no Terraform resource, so they must not be offered
        // for import — this is the eligibility branch in AlertRowMenu.
        await alertsPage.openRowMenu(alertsPage.getAlertCardByName(tileName));
        await expect(alertsPage.terraformMenuItem).toBeHidden();
      });
    },
  );

  test(
    'should create and update a dashboard tile alert with a custom display name and tags',
    { tag: '@full-stack' },
    async ({ page }) => {
      test.setTimeout(120000);
      const ts = Date.now();
      const tileName = `E2E Named Alert Tile ${ts}`;
      const displayName = `E2E Custom Tile Alert ${ts}`;
      const tag = `e2e-tile-tag-${ts}`;
      const updatedDisplayName = `E2E Renamed Tile Alert ${ts}`;
      const updatedTag = `e2e-tile-retag-${ts}`;
      const webhookName = `E2E Webhook Named Tile ${ts}`;
      const webhookUrl = `https://example.com/named-tile-${ts}`;

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

      await test.step('Enable an alert with a custom display name and tag', async () => {
        await expect(dashboardPage.chartEditor.alertButton).toBeVisible();
        await dashboardPage.chartEditor.clickAddAlert();
        await expect(
          dashboardPage.chartEditor.addNewWebhookButton,
        ).toBeVisible();
        await dashboardPage.chartEditor.setTileAlertDisplayName(displayName);
        await dashboardPage.chartEditor.addTileAlertTag(tag);
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

      await test.step('The alerts page finds it by its custom name and tag', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await alertsPage.filterToAlert(displayName);

        const card = alertsPage.getAlertCardByName(displayName);
        await expect(card).toBeVisible({ timeout: 10000 });
        await expect(card.getByText(tag)).toBeVisible();

        await alertsPage.searchByName(tileName);
        await expect(alertsPage.getAlertCardByName(tileName)).toHaveCount(0);
      });

      await test.step('The detail page shows the custom name and tag', async () => {
        await alertsPage.filterToAlert(displayName);
        await alertsPage.openDetails(
          alertsPage.getAlertCardByName(displayName),
        );
        await expect(alertsPage.detailName).toHaveText(displayName);
        await expect(alertsPage.detailTags).toContainText(tag);
      });

      await test.step('Rename and retag the alert from the tile editor', async () => {
        await alertsPage.detailSourceLink.click();
        await page.waitForURL(/\/dashboards\/[a-f0-9]{24}/);
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await dashboardPage.editTile(0);
        await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
        await dashboardPage.chartEditor.setTileAlertDisplayName(
          updatedDisplayName,
        );
        await dashboardPage.chartEditor.removeTileAlertTag(tag);
        await dashboardPage.chartEditor.addTileAlertTag(updatedTag);
        // The tile save issues a fire-and-forget PATCH; navigating away before
        // it lands would drop the update.
        const patch = dashboardPage.waitForDashboardPatch();
        await dashboardPage.chartEditor.save();
        await patch;
      });

      await test.step('The alerts page shows the updated name and tag', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await alertsPage.filterToAlert(updatedDisplayName);

        const card = alertsPage.getAlertCardByName(updatedDisplayName);
        await expect(card).toBeVisible({ timeout: 10000 });
        await expect(card.getByText(updatedTag)).toBeVisible();
        await expect(card.getByText(tag, { exact: true })).toHaveCount(0);

        await alertsPage.searchByName(displayName);
        await expect(alertsPage.getAlertCardByName(displayName)).toHaveCount(0);
      });

      await test.step('The detail page shows the updated name and tag', async () => {
        await alertsPage.filterToAlert(updatedDisplayName);
        await alertsPage.openDetails(
          alertsPage.getAlertCardByName(updatedDisplayName),
        );
        await expect(alertsPage.detailName).toHaveText(updatedDisplayName);
        await expect(alertsPage.detailTags).toContainText(updatedTag);
        await expect(alertsPage.detailTags).not.toContainText(tag);
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
        await alertsPage.filterToAlert(tileName);
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
        await alertsPage.filterToAlert(tileName);
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
        await alertsPage.filterToAlert(savedSearchName);
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
        await alertsPage.filterToAlert(tileName);
        await expect(
          alertsPage.pageContainer
            .getByRole('link')
            .filter({ hasText: tileName }),
        ).toBeVisible({ timeout: 10000 });
      });
    },
  );
});

test.describe(
  'Alert Lifecycle (create/update/delete)',
  { tag: ['@alerts', '@full-stack'] },
  () => {
    let searchPage: SearchPage;
    let alertsPage: AlertsPage;

    test.beforeEach(async ({ page }) => {
      searchPage = new SearchPage(page);
      alertsPage = new AlertsPage(page);
    });

    test(
      'should create, then update the interval of, then delete a saved-search alert',
      { tag: '@full-stack' },
      async () => {
        const ts = Date.now();
        const savedSearchName = `E2E Lifecycle Alert ${ts}`;
        const webhookName = `E2E Webhook Lifecycle ${ts}`;
        const webhookUrl = `https://example.com/lifecycle-${ts}`;

        await test.step('Create a saved search', async () => {
          await searchPage.goto();
          await searchPage.openSaveSearchModal();
          await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
            savedSearchName,
          );
        });

        await test.step('Create an alert with a 1 minute interval', async () => {
          await searchPage.openAlertsModal();
          await searchPage.alertModal.addWebhookAndWait(
            'Generic',
            webhookName,
            webhookUrl,
          );
          await searchPage.alertModal.selectWebhook(webhookName);
          // Start on a 1-minute cadence so the update below is observable.
          await searchPage.alertModal.selectInterval('1m');
          await searchPage.alertModal.createAlert();
        });

        await test.step('Reopen the alert and confirm the 1 minute interval persisted', async () => {
          await searchPage.openAlertsModal();
          await searchPage.alertModal.selectExistingAlertTab(0);
          expect(await searchPage.alertModal.getSelectedInterval()).toBe('1m');
        });

        await test.step('Change the interval to 5 minute and Save Alert (dispatches PUT)', async () => {
          await searchPage.alertModal.selectInterval('5m');
          await searchPage.alertModal.saveAlert();
        });

        await test.step('Reopen the alert and confirm the interval update was persisted', async () => {
          await searchPage.openAlertsModal();
          await searchPage.alertModal.selectExistingAlertTab(0);
          expect(await searchPage.alertModal.getSelectedInterval()).toBe('5m');
        });

        await test.step('Delete the alert', async () => {
          await searchPage.alertModal.deleteAlert();
        });

        await test.step('Verify the alert no longer appears on the alerts page', async () => {
          await alertsPage.goto();
          await expect(alertsPage.pageContainer).toBeVisible();
          // Search rather than scan the list: a virtualized row that is merely
          // outside the render window is also absent from the DOM, so this
          // assertion would pass whether or not the delete worked.
          await alertsPage.searchByName(savedSearchName);
          await expect(
            alertsPage.getAlertCardByName(savedSearchName),
          ).toBeHidden({ timeout: 10000 });
        });
      },
    );
  },
);

test.describe('Alert Notes', { tag: ['@alerts', '@full-stack'] }, () => {
  let searchPage: SearchPage;
  let dashboardPage: DashboardPage;
  let alertsPage: AlertsPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    dashboardPage = new DashboardPage(page);
    alertsPage = new AlertsPage(page);
  });

  test(
    'should create an alert with a note from a saved search and display it on the alerts page',
    { tag: '@full-stack' },
    async () => {
      const ts = Date.now();
      const savedSearchName = `E2E Note Alert Search ${ts}`;
      const webhookName = `E2E Webhook Note SS ${ts}`;
      const webhookUrl = `https://example.com/note-ss-${ts}`;
      const noteText =
        'Threshold set to **1** on initial setup. See [runbook](https://example.com).';

      await test.step('Create a saved search', async () => {
        await searchPage.goto();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          savedSearchName,
        );
      });

      await test.step('Open the alerts modal and create a webhook', async () => {
        await searchPage.openAlertsModal();
        await searchPage.alertModal.addWebhookAndWait(
          'Generic',
          webhookName,
          webhookUrl,
        );
      });

      await test.step('Fill in the note field', async () => {
        await searchPage.alertModal.setNote(noteText);
      });

      await test.step('Create the alert', async () => {
        await searchPage.alertModal.createAlert();
      });

      await test.step('Verify the note is displayed on the alerts page', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await alertsPage.filterToAlert(savedSearchName);
        const alertCard = alertsPage.getAlertCardByName(savedSearchName);
        await expect(alertCard).toBeVisible({ timeout: 10000 });

        // Note section should be present but content hidden by default
        const noteToggle = alertsPage.getNoteToggleForAlertCard(alertCard);
        await expect(noteToggle).toBeVisible();
        const noteContent = alertsPage.getNoteContentForAlertCard(alertCard);
        await expect(noteContent).toBeHidden();

        // Expand the note and verify rendered markdown content
        await alertsPage.expandNoteForAlertCard(alertCard);
        await expect(noteContent).toBeVisible();
        await expect(noteContent).toContainText('Threshold set to');
        // Verify markdown bold renders as <strong>
        await expect(noteContent.locator('strong')).toContainText('1');
        // Verify markdown link renders as <a> with security attributes
        const link = noteContent.locator('a');
        await expect(link).toContainText('runbook');
        await expect(link).toHaveAttribute('href', 'https://example.com');
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute(
          'rel',
          /noopener.*noreferrer.*nofollow/,
        );
      });
    },
  );

  test(
    'should create an alert with a note from a dashboard tile and display it on the alerts page',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const tileName = `E2E Note Alert Tile ${ts}`;
      const webhookName = `E2E Webhook Note Tile ${ts}`;
      const webhookUrl = `https://example.com/note-tile-${ts}`;
      const noteText = 'Alert added for **CPU spike** monitoring.';

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

      await test.step('Enable and configure an alert with a note', async () => {
        await dashboardPage.chartEditor.clickAddAlert();
        await dashboardPage.chartEditor.addNewWebhookButton.click();
        await expect(page.getByTestId('webhook-name-input')).toBeVisible();
        await dashboardPage.chartEditor.webhookAlertModal.addWebhook(
          'Generic',
          webhookName,
          webhookUrl,
        );
        await expect(page.getByTestId('alert-modal')).toBeHidden();
        await dashboardPage.chartEditor.setTileAlertNote(noteText);
      });

      await test.step('Save the tile with the alert configured', async () => {
        await dashboardPage.chartEditor.save();
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      await test.step('Verify the note is displayed on the alerts page', async () => {
        await alertsPage.goto();
        await expect(alertsPage.pageContainer).toBeVisible();
        await alertsPage.filterToAlert(tileName);
        const alertCard = alertsPage.getAlertCardByName(tileName);
        await expect(alertCard).toBeVisible({ timeout: 10000 });

        // Note section should be present but content hidden by default
        const noteToggle = alertsPage.getNoteToggleForAlertCard(alertCard);
        await expect(noteToggle).toBeVisible();
        const noteContent = alertsPage.getNoteContentForAlertCard(alertCard);
        await expect(noteContent).toBeHidden();

        // Expand the note and verify rendered markdown content
        await alertsPage.expandNoteForAlertCard(alertCard);
        await expect(noteContent).toBeVisible();
        await expect(noteContent).toContainText('CPU spike');
        await expect(noteContent.locator('strong')).toContainText('CPU spike');
      });
    },
  );
});

test.describe(
  'Alert Execution Errors',
  { tag: ['@alerts', '@full-stack'] },
  () => {
    let alertsPage: AlertsPage;

    test.beforeEach(async ({ page }) => {
      alertsPage = new AlertsPage(page);
      await alertsPage.goto();
      await expect(alertsPage.pageContainer).toBeVisible();
      // Every test here works on the one seeded alert; filtering to it keeps
      // its row inside the virtualized list's render window.
      await alertsPage.filterToAlert(SEEDED_ERROR_ALERT.savedSearchName);
    });

    test('shows alert errors with the correct type and message', async () => {
      const seededCard = alertsPage.getAlertCardByName(
        SEEDED_ERROR_ALERT.savedSearchName,
      );
      await expect(seededCard).toBeVisible({ timeout: 10000 });

      const errorIcon = alertsPage.getErrorIconForAlertCard(seededCard);
      await expect(errorIcon).toBeVisible();

      // Modal is hidden before the click
      await expect(alertsPage.errorModal).toBeHidden();

      await alertsPage.openErrorModalForAlertCard(seededCard);
      await expect(alertsPage.errorModal).toBeVisible();

      // QUERY_ERROR renders with the "Query Error" type label in the modal
      await expect(
        alertsPage.errorModal.getByText(/Query Error/),
      ).toBeVisible();

      // The <code> block contains the full seeded error message (not truncated)
      await expect(alertsPage.errorModalMessage).toContainText(
        SEEDED_ERROR_ALERT.errorMessage,
      );
    });

    test('shows an errored evaluation in the history strip with details on click', async () => {
      const seededCard = alertsPage.getAlertCardByName(
        SEEDED_ERROR_ALERT.savedSearchName,
      );
      await expect(seededCard).toBeVisible({ timeout: 10000 });

      // The seeded ERROR evaluation window renders as a clickable segment
      const errorSegment = alertsPage.getErrorHistorySegments(seededCard);
      await expect(errorSegment).toHaveCount(1);

      await errorSegment.click();
      await expect(alertsPage.evaluationErrorModal).toBeVisible();
      await expect(alertsPage.evaluationErrorModal).toContainText(
        'Query Timeout',
      );
      await expect(
        alertsPage.evaluationErrorModal.locator('pre'),
      ).toContainText(SEEDED_ERROR_ALERT.historyErrorMessage);
    });

    test('navigates to the alert detail page and shows the evaluation history', async () => {
      const seededCard = alertsPage.getAlertCardByName(
        SEEDED_ERROR_ALERT.savedSearchName,
      );
      await expect(seededCard).toBeVisible({ timeout: 10000 });

      await alertsPage.getDetailsLinkForAlertCard(seededCard).click();

      // Generous timeout: in dev mode the first hit compiles the new route,
      // which can take tens of seconds before the navigation completes.
      await alertsPage.page.waitForURL(/\/alerts\/[a-f0-9]{24}/, {
        timeout: 30000,
      });
      await expect(alertsPage.detailPageContainer).toBeVisible({
        timeout: 15000,
      });

      // The event stream lists the errored evaluation with its type label
      await expect(alertsPage.evaluationsTable).toBeVisible({
        timeout: 10000,
      });
      await expect(alertsPage.evaluationsTable).toContainText('Query Timeout');
      // ...and the OK window seeded alongside it
      await expect(
        alertsPage.evaluationsTable.locator(
          '[data-testid="alert-evaluation-row"]',
        ),
      ).toHaveCount(2);
    });
  },
);

test.describe('Alert Filtering', { tag: ['@alerts', '@full-stack'] }, () => {
  // Run serially so beforeAll seeding runs exactly once (not once per worker).
  test.describe.configure({ mode: 'serial' });

  let alertsPage: AlertsPage;
  const ts = Date.now();

  /**
   * Common to all three fixture names. Every test below searches by it first:
   * the org accumulates alerts from the specs that ran earlier, and the list is
   * virtualized, so an unfiltered fixture row can sit outside the render window
   * and therefore outside the DOM. These tests are about how filtering behaves,
   * not about where a row lands in a long list.
   */
  const seededScope = 'E2E Filter';

  const searchAlpha = {
    name: `E2E FilterAlpha ${ts}`,
    tags: [`team-alpha-${ts}`, `production-${ts}`],
  };
  const searchBeta = {
    name: `E2E FilterBeta ${ts}`,
    tags: [`team-beta-${ts}`, `staging-${ts}`],
  };
  const searchShared = {
    name: `E2E FilterShared ${ts}`,
    tags: [`team-alpha-${ts}`, `staging-${ts}`],
  };
  const webhookUrl = `https://example.com/filter-${ts}`;

  async function seedFilterTestData(page: import('@playwright/test').Page) {
    const apiUrl = getApiUrl();
    const sources = await getSources(page, 'log');
    const logSourceId = sources[0]._id;

    const uniqueUrl = `${webhookUrl}-${Date.now()}`;
    const webhookRes = await page.request.post(`${apiUrl}/webhooks`, {
      data: {
        name: `E2E Filter Webhook ${ts}`,
        service: 'generic',
        url: uniqueUrl,
      },
    });
    const webhook = (await webhookRes.json()).data;
    const channel = {
      type: 'webhook',
      webhookId: webhook._id ?? webhook.id,
    };

    for (const ss of [searchAlpha, searchBeta, searchShared]) {
      const ssRes = await page.request.post(`${apiUrl}/saved-search`, {
        data: {
          name: ss.name,
          select: '',
          where: '',
          whereLanguage: 'lucene',
          source: logSourceId,
          tags: ss.tags,
        },
      });
      const saved = await ssRes.json();

      await page.request.post(`${apiUrl}/alerts`, {
        data: {
          source: 'saved_search',
          savedSearchId: saved._id ?? saved.id,
          channel,
          interval: '5m',
          threshold: 10,
          thresholdType: 'above',
        },
      });
    }
  }

  test.beforeAll(async ({ browser }) => {
    const authFile = path.join(__dirname, '../.auth/user.json');
    const context = await browser.newContext({
      storageState: authFile,
    });
    const page = await context.newPage();
    await seedFilterTestData(page);
    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    alertsPage = new AlertsPage(page);
    await alertsPage.goto();
    await expect(alertsPage.pageContainer).toBeVisible();
    await expect(alertsPage.filters).toBeVisible({ timeout: 10000 });
    await alertsPage.searchByName(seededScope);
  });

  test('should show search and filter controls', async () => {
    await expect(alertsPage.searchField).toBeVisible();
    await expect(alertsPage.tagFilterDropdown).toBeVisible();
    await expect(alertsPage.creatorFilterDropdown).toBeVisible();
  });

  test('should filter alerts by name search', async () => {
    await test.step('All three seeded alerts are visible', async () => {
      await expect(alertsPage.getAlertCardByName(searchAlpha.name)).toBeVisible(
        { timeout: 10000 },
      );
      await expect(
        alertsPage.getAlertCardByName(searchBeta.name),
      ).toBeVisible();
      await expect(
        alertsPage.getAlertCardByName(searchShared.name),
      ).toBeVisible();
    });

    await test.step('Searching filters to matching alerts', async () => {
      await alertsPage.searchByName('FilterAlpha');
      await expect(
        alertsPage.getAlertCardByName(searchAlpha.name),
      ).toBeVisible();
      await expect(alertsPage.getAlertCardByName(searchBeta.name)).toBeHidden();
      await expect(
        alertsPage.getAlertCardByName(searchShared.name),
      ).toBeHidden();
    });

    await test.step('Search is persisted in the URL', async () => {
      await expect(alertsPage.page).toHaveURL(/search=/);
    });

    await test.step('Clearing search restores all alerts', async () => {
      await alertsPage.clearSearch();
      await expect(alertsPage.page).not.toHaveURL(/search=/);
      // Re-scope before asserting: with no search at all, these rows are back
      // among every other alert in the org and may fall outside the
      // virtualized render window. What matters is that the alerts excluded by
      // the FilterAlpha search are selectable again.
      await alertsPage.searchByName(seededScope);
      await expect(
        alertsPage.getAlertCardByName(searchAlpha.name),
      ).toBeVisible();
      await expect(
        alertsPage.getAlertCardByName(searchBeta.name),
      ).toBeVisible();
      await expect(
        alertsPage.getAlertCardByName(searchShared.name),
      ).toBeVisible();
    });
  });

  test('should filter alerts by tag', async () => {
    await expect(alertsPage.getAlertCardByName(searchAlpha.name)).toBeVisible({
      timeout: 10000,
    });

    await test.step('Selecting a tag filters to matching alerts', async () => {
      await alertsPage.selectTag(`team-beta-${ts}`);
      await expect(
        alertsPage.getAlertCardByName(searchBeta.name),
      ).toBeVisible();
      await expect(
        alertsPage.getAlertCardByName(searchAlpha.name),
      ).toBeHidden();
      await expect(
        alertsPage.getAlertCardByName(searchShared.name),
      ).toBeHidden();
    });

    await test.step('Tag filter is persisted in the URL', async () => {
      await expect(alertsPage.page).toHaveURL(/tag=/);
    });

    await test.step('Clearing tag filter restores all alerts', async () => {
      await alertsPage.clearTagFilter();
      await expect(
        alertsPage.getAlertCardByName(searchAlpha.name),
      ).toBeVisible();
      await expect(
        alertsPage.getAlertCardByName(searchBeta.name),
      ).toBeVisible();
    });
  });

  test('should filter alerts by tag shared across sources', async () => {
    await expect(alertsPage.getAlertCardByName(searchAlpha.name)).toBeVisible({
      timeout: 10000,
    });

    await alertsPage.selectTag(`staging-${ts}`);
    await expect(alertsPage.getAlertCardByName(searchBeta.name)).toBeVisible();
    await expect(
      alertsPage.getAlertCardByName(searchShared.name),
    ).toBeVisible();
    await expect(alertsPage.getAlertCardByName(searchAlpha.name)).toBeHidden();
  });

  test('should show empty state when no alerts match filters', async () => {
    await expect(alertsPage.getAlertCardByName(searchAlpha.name)).toBeVisible({
      timeout: 10000,
    });

    await alertsPage.searchByName(`nonexistent-${ts}`);
    await expect(
      alertsPage.pageContainer.getByText('No matching alerts'),
    ).toBeVisible();
  });

  test('should load filtered view from URL params', async ({ page }) => {
    await page.goto(`/alerts?tag=team-beta-${ts}`);
    await expect(alertsPage.pageContainer).toBeVisible();
    await expect(alertsPage.filters).toBeVisible({ timeout: 10000 });

    await expect(alertsPage.getAlertCardByName(searchBeta.name)).toBeVisible({
      timeout: 10000,
    });
    await expect(alertsPage.getAlertCardByName(searchAlpha.name)).toBeHidden();
  });
});
