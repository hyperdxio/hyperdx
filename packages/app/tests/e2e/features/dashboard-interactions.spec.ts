import { DashboardPage } from '../page-objects/DashboardPage';
import { DashboardsListPage } from '../page-objects/DashboardsListPage';
import { expect, test } from '../utils/base-test';
import { DEFAULT_LOGS_SOURCE_NAME } from '../utils/constants';

test.describe('Dashboard Interactions', { tag: ['@dashboard'] }, () => {
  let dashboardPage: DashboardPage;
  let dashboardsListPage: DashboardsListPage;

  test.beforeEach(async ({ page }) => {
    dashboardPage = new DashboardPage(page);
    dashboardsListPage = new DashboardsListPage(page);
    await dashboardPage.goto();
  });

  test('should duplicate a tile and verify both tiles exist', async () => {
    const ts = Date.now();
    const chartName = `Original Chart ${ts}`;

    await test.step('Create a new dashboard', async () => {
      await expect(dashboardPage.createButton).toBeVisible();
      await dashboardPage.createNewDashboard();
    });

    await test.step('Add a tile to the dashboard', async () => {
      await expect(dashboardPage.addButton).toBeVisible();
      await dashboardPage.addTile();

      await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      await dashboardPage.chartEditor.createBasicChart(chartName);

      const dashboardTiles = dashboardPage.getTiles();
      await expect(dashboardTiles).toHaveCount(1, { timeout: 10000 });
    });

    await test.step('Duplicate the tile and verify both tiles exist', async () => {
      await dashboardPage.duplicateTile(0);

      const dashboardTiles = dashboardPage.getTiles();
      await expect(dashboardTiles).toHaveCount(2, { timeout: 10000 });

      const firstTile = dashboardPage.getTile(0);
      const secondTile = dashboardPage.getTile(1);
      await expect(firstTile).toBeVisible();
      await expect(secondTile).toBeVisible();
    });
  });

  test('should add a dashboard section', async () => {
    await test.step('Create a new dashboard', async () => {
      await expect(dashboardPage.createButton).toBeVisible();
      await dashboardPage.createNewDashboard();
    });

    await test.step('Add a section to the dashboard', async () => {
      await dashboardPage.addSection();
      await dashboardPage.page.waitForLoadState('networkidle');

      // Verify that a section heading appears
      const sectionHeader = dashboardPage.page.locator(
        '[data-testid^="section-header-"]',
      );
      await expect(sectionHeader).toBeVisible({ timeout: 15000 });
    });
  });

  test('should edit a tile and update its configuration', async () => {
    const ts = Date.now();
    const originalName = `Test Chart ${ts}`;
    const updatedName = `Updated Chart ${ts}`;

    await test.step('Create a new dashboard with a tile', async () => {
      await expect(dashboardPage.createButton).toBeVisible();
      await dashboardPage.createNewDashboard();

      await expect(dashboardPage.addButton).toBeVisible();
      await dashboardPage.addTile();

      await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      await dashboardPage.chartEditor.createBasicChart(originalName);

      const dashboardTiles = dashboardPage.getTiles();
      await expect(dashboardTiles).toHaveCount(1, { timeout: 10000 });
    });

    await test.step('Edit the tile and change its name', async () => {
      await dashboardPage.editTile(0);

      await expect(dashboardPage.chartEditor.nameInput).toBeVisible();
      await dashboardPage.chartEditor.setChartName(updatedName);

      await dashboardPage.saveTile();
    });

    await test.step('Verify the updated name appears on the dashboard', async () => {
      const tile = dashboardPage.getTiles().filter({ hasText: updatedName });
      await expect(tile).toBeVisible({ timeout: 10000 });
    });
  });

  test('should open and close the dashboard filters modal', async () => {
    await test.step('Create a new dashboard', async () => {
      await expect(dashboardPage.createButton).toBeVisible();
      await dashboardPage.createNewDashboard();
    });

    await test.step('Open the filters modal and verify empty state', async () => {
      await dashboardPage.openEditFiltersModal();
      await expect(dashboardPage.emptyFiltersList).toBeVisible();
    });

    await test.step('Close the filters modal with Escape', async () => {
      await dashboardPage.page.keyboard.press('Escape');
      await expect(dashboardPage.emptyFiltersList).toBeHidden();
    });
  });

  test('should delete a dashboard from the listing page', async () => {
    const ts = Date.now();
    const dashboardName = `Delete Me Dashboard ${ts}`;

    await test.step('Create and name a new dashboard', async () => {
      await expect(dashboardPage.createButton).toBeVisible();
      await dashboardPage.createNewDashboard();

      await dashboardPage.editDashboardName(dashboardName);

      const heading = dashboardPage.getDashboardHeading(dashboardName);
      await expect(heading).toBeVisible({ timeout: 10000 });
    });

    await test.step('Navigate to dashboards list and verify the dashboard appears', async () => {
      await dashboardsListPage.goto();

      const card = dashboardsListPage.getDashboardCard(dashboardName);
      await expect(card).toBeVisible({ timeout: 10000 });
    });

    await test.step('Delete the dashboard from the listing page', async () => {
      await dashboardsListPage.deleteDashboardFromCard(dashboardName);

      const card = dashboardsListPage.getDashboardCard(dashboardName);
      await expect(card).toHaveCount(0, { timeout: 10000 });
    });
  });
});
