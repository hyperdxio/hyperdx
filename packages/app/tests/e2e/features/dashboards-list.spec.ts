import { DashboardPage } from '../page-objects/DashboardPage';
import { DashboardsListPage } from '../page-objects/DashboardsListPage';
import { getApiUrl } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';

test.describe('Dashboards Listing Page', { tag: ['@dashboard'] }, () => {
  let dashboardsListPage: DashboardsListPage;
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboardsListPage = new DashboardsListPage(page);
    dashboardPage = new DashboardPage(page);
  });

  test(
    'should display the dashboards listing page with preset dashboards',
    { tag: '@full-stack' },
    async () => {
      await dashboardsListPage.goto();

      await test.step('Verify the page container is visible', async () => {
        await expect(dashboardsListPage.pageContainer).toBeVisible();
      });

      await test.step('Verify preset dashboard cards are visible', async () => {
        await expect(
          dashboardsListPage.getPresetDashboardCard('Services'),
        ).toBeVisible();
        await expect(
          dashboardsListPage.getPresetDashboardCard('ClickHouse'),
        ).toBeVisible();
        await expect(
          dashboardsListPage.getPresetDashboardCard('Kubernetes'),
        ).toBeVisible();
      });
    },
  );

  test(
    'should create a new dashboard from the listing page',
    { tag: '@full-stack' },
    async ({ page }) => {
      await dashboardsListPage.goto();

      await test.step('Click the New Dashboard button', async () => {
        await dashboardsListPage.createNewDashboard();
      });

      await test.step('Verify navigation to the individual dashboard page', async () => {
        await expect(page).toHaveURL(/\/dashboards\/.+/);
      });

      await test.step('Verify the dashboard name heading "My Dashboard" is visible', async () => {
        await expect(
          page.getByRole('heading', { name: 'My Dashboard', level: 3 }),
        ).toBeVisible();
      });
    },
  );

  test('should search dashboards by name', { tag: '@full-stack' }, async () => {
    const ts = Date.now();
    const uniqueName = `E2E Search Dashboard ${ts}`;

    await test.step('Create a dashboard with a unique name', async () => {
      await dashboardsListPage.goto();
      await dashboardsListPage.createNewDashboard();
      await dashboardPage.editDashboardName(uniqueName);
    });

    await test.step('Navigate to the dashboards listing page', async () => {
      await dashboardsListPage.goto();
    });

    await test.step('Search for the unique dashboard name', async () => {
      await dashboardsListPage.searchDashboards(uniqueName);
    });

    await test.step('Verify the dashboard appears in results', async () => {
      await expect(
        dashboardsListPage.getDashboardCard(uniqueName),
      ).toBeVisible();
    });

    await test.step('Search for a non-existent name', async () => {
      await dashboardsListPage.searchDashboards(
        `nonexistent-dashboard-xyz-${ts}`,
      );
    });

    await test.step('Verify no matches state is shown', async () => {
      await expect(dashboardsListPage.getNoMatchesState()).toBeVisible();
    });
  });

  test(
    'should switch between grid and list views',
    { tag: '@full-stack' },
    async () => {
      const ts = Date.now();
      const uniqueName = `E2E View Toggle Dashboard ${ts}`;

      await test.step('Create a dashboard with a unique name', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(uniqueName);
      });

      await test.step('Navigate to the dashboards listing page', async () => {
        await dashboardsListPage.goto();
      });

      await test.step('Verify grid view is the default and dashboard card is visible', async () => {
        await expect(
          dashboardsListPage.getDashboardCard(uniqueName),
        ).toBeVisible();
      });

      await test.step('Switch to list view', async () => {
        await dashboardsListPage.switchToListView();
      });

      await test.step('Verify the dashboard appears in a table row', async () => {
        await expect(
          dashboardsListPage.getDashboardRow(uniqueName),
        ).toBeVisible();
      });

      await test.step('Switch back to grid view', async () => {
        await dashboardsListPage.switchToGridView();
      });

      await test.step('Verify the dashboard card reappears', async () => {
        await expect(
          dashboardsListPage.getDashboardCard(uniqueName),
        ).toBeVisible();
      });
    },
  );

  test(
    'should delete a dashboard from the listing page',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const uniqueName = `E2E Delete Dashboard ${ts}`;

      await test.step('Create a dashboard with a unique name', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(uniqueName);
      });

      await test.step('Navigate to the dashboards listing page', async () => {
        await dashboardsListPage.goto();
      });

      await test.step('Delete the dashboard via the card menu', async () => {
        await dashboardsListPage.deleteDashboardFromCard(uniqueName);
      });

      await test.step('Verify the dashboard is no longer visible', async () => {
        await expect(
          dashboardsListPage.getDashboardCard(uniqueName),
        ).toBeHidden();
      });

      await test.step('Verify the "Dashboard deleted" notification appears', async () => {
        await expect(page.getByText('Dashboard deleted')).toBeVisible();
      });
    },
  );

  test(
    'should filter dashboards by tag',
    { tag: '@full-stack' },
    async ({ page }) => {
      const ts = Date.now();
      const taggedName = `E2E Tagged Dashboard ${ts}`;
      const untaggedName = `E2E Untagged Dashboard ${ts}`;
      const tag = `e2e-tag-${ts}`;
      const API_URL = getApiUrl();

      await test.step('Create a dashboard with a tag', async () => {
        // Create dashboard
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(taggedName);

        // Extract dashboard ID from the URL and PATCH tags via API
        const dashboardId = page.url().split('/dashboards/')[1]?.split('?')[0];
        await page.request.patch(`${API_URL}/dashboards/${dashboardId}`, {
          data: { tags: [tag] },
        });
      });

      await test.step('Create a dashboard without the tag', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(untaggedName);
      });

      await test.step('Navigate to the listing page and verify both are visible', async () => {
        await dashboardsListPage.goto();
        await expect(
          dashboardsListPage.getDashboardCard(taggedName),
        ).toBeVisible();
        await expect(
          dashboardsListPage.getDashboardCard(untaggedName),
        ).toBeVisible();
      });

      await test.step('Select the tag filter', async () => {
        await dashboardsListPage.selectTagFilter(tag);
      });

      await test.step('Verify only the tagged dashboard is shown', async () => {
        await expect(
          dashboardsListPage.getDashboardCard(taggedName),
        ).toBeVisible();
        await expect(
          dashboardsListPage.getDashboardCard(untaggedName),
        ).toBeHidden();
      });

      await test.step('Clear the tag filter', async () => {
        await dashboardsListPage.clearTagFilter();
      });

      await test.step('Verify both dashboards are visible again', async () => {
        await expect(
          dashboardsListPage.getDashboardCard(taggedName),
        ).toBeVisible();
        await expect(
          dashboardsListPage.getDashboardCard(untaggedName),
        ).toBeVisible();
      });
    },
  );
});
