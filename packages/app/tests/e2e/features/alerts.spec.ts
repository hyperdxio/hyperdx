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

test.describe(
  'Alert Execution Errors',
  { tag: ['@alerts', '@full-stack'] },
  () => {
    let alertsPage: AlertsPage;

    test.beforeEach(async ({ page }) => {
      alertsPage = new AlertsPage(page);
      await alertsPage.goto();
      await expect(alertsPage.pageContainer).toBeVisible();
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
  },
);

test.describe('Alert Filtering', { tag: ['@alerts', '@full-stack'] }, () => {
  let alertsPage: AlertsPage;
  const ts = Date.now();

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

    const webhookRes = await page.request.post(`${apiUrl}/webhooks`, {
      data: {
        name: `E2E Filter Webhook ${ts}`,
        service: 'generic',
        url: webhookUrl,
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
