import { DashboardPage } from '../page-objects/DashboardPage';
import { DashboardsListPage } from '../page-objects/DashboardsListPage';
import { expect, test } from '../utils/base-test';

test.describe('Temporary Dashboard', { tag: ['@dashboard'] }, () => {
  let dashboardPage: DashboardPage;
  let dashboardsListPage: DashboardsListPage;

  test.beforeEach(({ page }) => {
    dashboardPage = new DashboardPage(page);
    dashboardsListPage = new DashboardsListPage(page);
  });

  test(
    'should navigate from listing page to temporary dashboard',
    { tag: '@full-stack' },
    async ({ page }) => {
      await dashboardsListPage.goto();

      await test.step('Click New Dashboard and select Temporary Dashboard', async () => {
        await dashboardsListPage.goToTempDashboard();
      });

      await test.step('Verify the temporary dashboard banner is visible', async () => {
        await expect(dashboardPage.temporaryDashboardBanner).toBeVisible();
        await expect(dashboardPage.temporaryDashboardBanner).toContainText(
          'This is a temporary dashboard and can not be saved.',
        );
      });
    },
  );

  test(
    'should persist temporary dashboard content in URL params across navigation',
    {},
    async ({ page }) => {
      await dashboardPage.goto();

      await test.step('Verify the temporary dashboard banner is visible', async () => {
        await expect(dashboardPage.temporaryDashboardBanner).toBeVisible();
      });

      await test.step('Add a tile to the temporary dashboard', async () => {
        await dashboardPage.addTile();
        await dashboardPage.chartEditor.createBasicChart('Temp Chart');
      });

      await test.step('Verify the tile and chart render', async () => {
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(dashboardPage.getChartContainers()).toHaveCount(1, {
          timeout: 10000,
        });
      });

      let savedUrl: string;

      await test.step('Verify the URL contains the dashboard query param', () => {
        savedUrl = page.url();
        expect(savedUrl).toContain('dashboard=');
      });

      await test.step('Navigate away to /search', async () => {
        await page.goto('/search');
        await expect(page).toHaveURL(/\/search/);
      });

      await test.step('Navigate back and verify persistence', async () => {
        await page.goto(savedUrl);
        await expect(dashboardPage.getTiles()).toHaveCount(1, {
          timeout: 10000,
        });
        await expect(dashboardPage.getChartContainers().first()).toBeVisible({
          timeout: 10000,
        });
      });
    },
  );

  test(
    'should convert temporary dashboard to saved dashboard',
    { tag: '@full-stack' },
    async ({ page }) => {
      await dashboardPage.goto();

      await test.step('Verify the temporary dashboard banner is visible', async () => {
        await expect(dashboardPage.temporaryDashboardBanner).toBeVisible();
      });

      await test.step('Click Create New Saved Dashboard', async () => {
        await dashboardPage.createButton.click();
      });

      await test.step('Verify navigation to a saved dashboard', async () => {
        await expect(page).toHaveURL(/\/dashboards\/.+/, { timeout: 10000 });
      });

      await test.step('Verify the temporary banner is replaced by breadcrumbs', async () => {
        await expect(dashboardPage.temporaryDashboardBanner).toBeHidden();
        await expect(
          page
            .getByTestId('dashboard-page')
            .getByRole('link', { name: 'Dashboards' }),
        ).toBeVisible();
      });
    },
  );
});
