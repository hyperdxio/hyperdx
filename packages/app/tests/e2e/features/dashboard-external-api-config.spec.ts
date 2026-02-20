/**
 * External API E2E Tests for Dashboard Creation (Config Format)
 *
 * Tests the external API endpoint for creating dashboards via REST API
 * using the "config" format instead of the deprecated "series" format.
 * See dashboard-external-api.spec.ts for the equivalent tests using the
 * legacy "series" format.
 */
import { DashboardPage, TileConfig } from '../page-objects/DashboardPage';
import { getApiUrl, getSources, getUserAccessKey } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';

test.describe(
  'Dashboard External API (Config Format)',
  { tag: ['@full-stack', '@api'] },
  () => {
    const API_URL = getApiUrl();
    const BASE_URL = `${API_URL}/api/v2/dashboards`;

    let accessKey: string;
    let sourceId: string;
    let sourceName: string;

    // Helper function to generate unique dashboard names
    const generateUniqueDashboardName = (baseName: string) => {
      const timestamp = Date.now();
      const random = Math.random().toString(36).substring(2, 8);
      return `${baseName} ${timestamp}-${random}`;
    };

    test.beforeEach(async ({ page }) => {
      // Get the current user's access key for API authentication
      accessKey = await getUserAccessKey(page);

      // Get available log sources to use in dashboard tiles
      const logSources = await getSources(page, 'log');
      expect(logSources.length).toBeGreaterThan(0);

      // Use the first available log source for our test dashboard
      const selectedSource = logSources[0];
      sourceId = selectedSource._id;
      sourceName = selectedSource.name;
    });

    test('should create a dashboard with multiple chart types via external API', async ({
      page,
    }) => {
      const dashboardPayload = {
        name: generateUniqueDashboardName('Dashboard'),
        tiles: [
          {
            name: 'Time Series Chart',
            x: 0,
            y: 0,
            w: 12,
            h: 4,
            config: {
              displayType: 'line',
              sourceId: sourceId,
              select: [
                {
                  aggFn: 'count',
                  where: "SeverityText = 'error'",
                  whereLanguage: 'sql',
                  alias: 'Error Count',
                },
                {
                  aggFn: 'max',
                  valueExpression: 'length(ServiceName)',
                  where: "SeverityText = 'error'",
                  whereLanguage: 'sql',
                  alias: 'Max Service Name Length',
                },
              ],
            },
          },
          {
            name: 'Number Chart',
            x: 12,
            y: 0,
            w: 12,
            h: 4,
            config: {
              displayType: 'number',
              sourceId: sourceId,
              select: [
                {
                  aggFn: 'max',
                  valueExpression: 'length(ServiceName)',
                  where: 'ServiceName:*',
                  whereLanguage: 'lucene',
                  alias: 'Max Service Name Length',
                },
              ],
            },
          },
          {
            name: 'Table Chart',
            x: 0,
            y: 4,
            w: 12,
            h: 4,
            config: {
              displayType: 'table',
              sourceId: sourceId,
              select: [
                {
                  aggFn: 'count',
                  where: 'SeverityText:*',
                  alias: 'Non-Debug Events by Service',
                },
              ],
              groupBy: 'ServiceName',
            },
          },
          {
            name: 'Search Chart',
            x: 12,
            y: 4,
            w: 12,
            h: 4,
            config: {
              displayType: 'search',
              sourceId: sourceId,
              select: 'ServiceName, Body, SeverityText',
              where: 'SeverityText:"info"',
              whereLanguage: 'lucene',
            },
          },
          {
            name: 'Markdown Widget',
            x: 0,
            y: 8,
            w: 12,
            h: 4,
            config: {
              displayType: 'markdown',
              markdown:
                '# Dashboard Info\n\nThis dashboard was created via the external API.',
            },
          },
        ],
        tags: ['e2e-test'],
      };

      let dashboardPage: DashboardPage;
      let tiles: any;

      await test.step('Create dashboard via external API', async () => {
        const createResponse = await page.request.post(BASE_URL, {
          headers: {
            Authorization: `Bearer ${accessKey}`,
            'Content-Type': 'application/json',
          },
          data: dashboardPayload,
        });

        expect(createResponse.ok()).toBeTruthy();
      });

      await test.step('Navigate to dashboard and verify tiles', async () => {
        dashboardPage = new DashboardPage(page);
        await dashboardPage.goto(); // Navigate to dashboards list

        // Find and click on the created dashboard
        await dashboardPage.goToDashboardByName(dashboardPayload.name);

        await expect(
          page.getByRole('heading', { name: dashboardPayload.name }),
        ).toBeVisible({ timeout: 10000 });

        // Verify all tiles are rendered
        tiles = page.locator('[data-testid^="dashboard-tile-"]');
        await expect(tiles).toHaveCount(5, { timeout: 10000 });
      });

      await test.step('Verify each tile configuration', async () => {
        for (let i = 0; i < dashboardPayload.tiles.length; i++) {
          const tileData = dashboardPayload.tiles[i];

          // Hover over tile to reveal edit button
          await tiles.nth(i).hover();

          // Click edit button for this tile
          const editButton = page
            .locator(`[data-testid^="tile-edit-button-"]`)
            .nth(i);
          await expect(editButton).toBeVisible();
          await editButton.click();

          // Wait for chart editor modal to open
          const chartNameInput = page.getByTestId('chart-name-input');
          await expect(chartNameInput).toBeVisible({ timeout: 5000 });

          // Verify chart name matches
          await expect(chartNameInput).toHaveValue(tileData.name);

          // Verify tile edit form
          await dashboardPage.verifyTileFormFromConfig(
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            tileData.config as TileConfig,
            sourceName,
          );

          // Close the modal by pressing Escape
          await page.keyboard.press('Escape');

          // Wait for modal to close
          await expect(chartNameInput).toBeHidden({ timeout: 5000 });
        }
      });

      // Test that we can update the dashboard, proving that the dashboard can be saved after creation in the UI
      // (indicating that the saved value of the dashboard conforms to the expected schema of the internal dashboard API)
      await test.step('Duplicate a tile via UI', async () => {
        // Duplicate the first tile
        await dashboardPage.duplicateTile(0);

        // Verify the duplicated tile was added (should now have 6 tiles)
        await expect(tiles).toHaveCount(6, { timeout: 10000 });
      });
    });

    test('should update dashboard via external API', async ({ page }) => {
      // Create a dashboard
      const initialPayload = {
        name: generateUniqueDashboardName('Update Test Dashboard'),
        tiles: [
          {
            name: 'Original Chart',
            x: 0,
            y: 0,
            w: 6,
            h: 3,
            config: {
              displayType: 'line',
              sourceId: sourceId,
              select: [
                {
                  aggFn: 'count',
                  where: '',
                },
              ],
            },
          },
        ],
        tags: ['update-test'],
      };

      const createResponse = await page.request.post(BASE_URL, {
        headers: {
          Authorization: `Bearer ${accessKey}`,
          'Content-Type': 'application/json',
        },
        data: initialPayload,
      });

      expect(createResponse.ok()).toBeTruthy();
      const createdDashboard = (await createResponse.json()).data;
      const dashboardId = createdDashboard.id;
      const tileId = createdDashboard.tiles[0].id;

      const originalName = createdDashboard.name;
      const updatedName = originalName + ' Updated';

      // Update the dashboard
      const updatedPayload = {
        name: updatedName,
        tiles: [
          {
            id: tileId,
            name: 'Updated Chart',
            x: 0,
            y: 0,
            w: 12,
            h: 4,
            config: {
              displayType: 'line',
              sourceId: sourceId,
              select: [
                {
                  aggFn: 'sum',
                  valueExpression: 'Duration',
                  where: '',
                },
              ],
              groupBy: 'ServiceName',
            },
          },
        ],
        tags: ['update-test'],
      };

      const updateResponse = await page.request.put(
        `${BASE_URL}/${dashboardId}`,
        {
          headers: {
            Authorization: `Bearer ${accessKey}`,
            'Content-Type': 'application/json',
          },
          data: updatedPayload,
        },
      );

      expect(updateResponse.ok()).toBeTruthy();

      // Navigate to dashboard through UI (via AppNav)
      const dashboardPage = new DashboardPage(page);
      await dashboardPage.goto(); // Navigate to dashboards list

      // Find and click on the updated dashboard
      await dashboardPage.goToDashboardByName(updatedName);

      await expect(
        page.getByRole('heading', { name: updatedName }),
      ).toBeVisible({ timeout: 10000 });
    });

    test('should delete dashboard via external API', async ({ page }) => {
      // Create two dashboards - one to delete, one to keep
      const dashboardToDelete = {
        name: generateUniqueDashboardName('Delete Test Dashboard'),
        tiles: [],
        tags: ['delete-test'],
      };

      const dashboardToKeep = {
        name: generateUniqueDashboardName('Keep Test Dashboard'),
        tiles: [],
        tags: ['delete-test'],
      };

      const createResponse1 = await page.request.post(BASE_URL, {
        headers: {
          Authorization: `Bearer ${accessKey}`,
          'Content-Type': 'application/json',
        },
        data: dashboardToDelete,
      });

      expect(createResponse1.ok()).toBeTruthy();
      const dashboardId = (await createResponse1.json()).data.id;

      const createResponse2 = await page.request.post(BASE_URL, {
        headers: {
          Authorization: `Bearer ${accessKey}`,
          'Content-Type': 'application/json',
        },
        data: dashboardToKeep,
      });

      expect(createResponse2.ok()).toBeTruthy();

      // Delete the first dashboard
      const deleteResponse = await page.request.delete(
        `${BASE_URL}/${dashboardId}`,
        {
          headers: {
            Authorization: `Bearer ${accessKey}`,
          },
        },
      );

      expect(deleteResponse.ok()).toBeTruthy();

      // Verify dashboard is deleted via API
      const getResponse = await page.request.get(`${BASE_URL}/${dashboardId}`, {
        headers: {
          Authorization: `Bearer ${accessKey}`,
        },
      });

      expect(getResponse.status()).toBe(404);

      // Verify dashboard is not present in UI
      const dashboardPage = new DashboardPage(page);
      await dashboardPage.goto(); // Navigate to dashboards list

      // First verify the kept dashboard is visible (ensures data has loaded)
      const keptDashboardLink = page.locator(`text="${dashboardToKeep.name}"`);
      await expect(keptDashboardLink).toBeVisible({ timeout: 10000 });

      // Then verify the deleted dashboard is not visible in the list
      const deletedDashboardLink = page.locator(
        `text="${dashboardToDelete.name}"`,
      );
      await expect(deletedDashboardLink).toHaveCount(0);
    });
  },
);
