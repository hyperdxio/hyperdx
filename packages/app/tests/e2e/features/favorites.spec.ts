import { DashboardPage } from '../page-objects/DashboardPage';
import { DashboardsListPage } from '../page-objects/DashboardsListPage';
import { SavedSearchesListPage } from '../page-objects/SavedSearchesListPage';
import { getApiUrl, getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';

/**
 * Helper to create a saved search via the API.
 */
async function createSavedSearchViaApi(
  page: import('@playwright/test').Page,
  overrides: Record<string, unknown> = {},
) {
  const API_URL = getApiUrl();
  const logSources = await getSources(page, 'log');
  const sourceId = logSources[0]._id;
  const defaults = {
    name: `E2E Saved Search ${Date.now()}`,
    select: 'Timestamp, Body',
    where: '',
    whereLanguage: 'lucene',
    source: sourceId,
    tags: [] as string[],
  };
  const body = { ...defaults, ...overrides };
  const response = await page.request.post(`${API_URL}/saved-search`, {
    data: body,
  });
  if (!response.ok()) {
    throw new Error(
      `Failed to create saved search: ${response.status()} ${await response.text()}`,
    );
  }
  return response.json();
}

test.describe(
  'Dashboard Favorites',
  { tag: ['@dashboard', '@full-stack'] },
  () => {
    let dashboardsListPage: DashboardsListPage;
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardsListPage = new DashboardsListPage(page);
      dashboardPage = new DashboardPage(page);
    });

    test('should favorite and unfavorite a dashboard in grid view', async () => {
      const ts = Date.now();
      const name = `E2E Fav Dashboard ${ts}`;

      await test.step('Create a dashboard', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(name);
      });

      await test.step('Navigate to listing and verify item is not favorited', async () => {
        await dashboardsListPage.goto();
        await expect(
          dashboardsListPage.getFavoritedDashboardCard(name),
        ).toBeHidden();
      });

      await test.step('Favorite the dashboard', async () => {
        await dashboardsListPage.toggleFavoriteOnCard(name);
      });

      await test.step('Verify the dashboard appears in the favorites section', async () => {
        await expect(dashboardsListPage.getFavoritesSection()).toBeVisible();
        await expect(
          dashboardsListPage.getFavoritedDashboardCard(name),
        ).toBeVisible();
      });

      await test.step('Unfavorite the dashboard from the favorites section', async () => {
        await dashboardsListPage.toggleFavoriteOnFavoritedCard(name);
      });

      await test.step('Verify the dashboard is removed from favorites', async () => {
        await expect(
          dashboardsListPage.getFavoritedDashboardCard(name),
        ).toBeHidden();
      });
    });

    test('should favorite a dashboard in list view', async () => {
      const ts = Date.now();
      const name = `E2E Fav List Dashboard ${ts}`;

      await test.step('Create a dashboard', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(name);
      });

      await test.step('Switch to list view and favorite the dashboard', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.switchToListView();
        await dashboardsListPage.toggleFavoriteOnRow(name);
      });

      await test.step('Verify the favorites section appears with the dashboard', async () => {
        await expect(dashboardsListPage.getFavoritesSection()).toBeVisible();
        await expect(
          dashboardsListPage.getFavoritedDashboardCard(name),
        ).toBeVisible();
      });
    });

    test('should persist favorites across page reloads', async () => {
      const ts = Date.now();
      const name = `E2E Persist Fav Dashboard ${ts}`;

      await test.step('Create and favorite a dashboard', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(name);
        await dashboardsListPage.goto();
        await dashboardsListPage.toggleFavoriteOnCard(name);
        await expect(
          dashboardsListPage.getFavoritedDashboardCard(name),
        ).toBeVisible();
      });

      await test.step('Reload the page and verify favorite persists', async () => {
        await dashboardsListPage.goto();
        await expect(dashboardsListPage.getFavoritesSection()).toBeVisible();
        await expect(
          dashboardsListPage.getFavoritedDashboardCard(name),
        ).toBeVisible();
      });
    });

    test('should show favorited dashboard in sidebar and navigate to it', async ({
      page,
    }) => {
      const ts = Date.now();
      const name = `E2E Sidebar Dashboard ${ts}`;

      await test.step('Create a dashboard', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await dashboardPage.editDashboardName(name);
      });

      await test.step('Favorite the dashboard', async () => {
        await dashboardsListPage.goto();
        await dashboardsListPage.toggleFavoriteOnCard(name);
      });

      await test.step('Verify the sidebar shows the favorited dashboard', async () => {
        const sidebarLink = page
          .locator('a[href^="/dashboards/"]')
          .filter({ hasText: name });
        await expect(sidebarLink).toBeVisible();
      });

      await test.step('Click the sidebar link and verify navigation', async () => {
        const sidebarLink = page
          .locator('a[href^="/dashboards/"]')
          .filter({ hasText: name });
        await sidebarLink.click();
        await page.waitForURL('**/dashboards/**');
        expect(page.url()).toContain('/dashboards/');
      });
    });
  },
);

test.describe(
  'Saved Search Favorites',
  { tag: ['@search', '@full-stack'] },
  () => {
    let savedSearchesListPage: SavedSearchesListPage;

    test.beforeEach(async ({ page }) => {
      savedSearchesListPage = new SavedSearchesListPage(page);
    });

    test('should favorite and unfavorite a saved search in grid view', async ({
      page,
    }) => {
      const ts = Date.now();
      const name = `E2E Fav Search ${ts}`;

      await test.step('Create a saved search via API', async () => {
        await createSavedSearchViaApi(page, { name });
      });

      await test.step('Navigate to listing and verify item is not favorited', async () => {
        await savedSearchesListPage.goto();
        await expect(
          savedSearchesListPage.getFavoritedSearchCard(name),
        ).toBeHidden();
      });

      await test.step('Favorite the saved search', async () => {
        await savedSearchesListPage.toggleFavoriteOnCard(name);
      });

      await test.step('Verify the saved search appears in the favorites section', async () => {
        await expect(savedSearchesListPage.getFavoritesSection()).toBeVisible();
        await expect(
          savedSearchesListPage.getFavoritedSearchCard(name),
        ).toBeVisible();
      });

      await test.step('Unfavorite the saved search from the favorites section', async () => {
        await savedSearchesListPage.toggleFavoriteOnFavoritedCard(name);
      });

      await test.step('Verify the saved search is removed from favorites', async () => {
        await expect(
          savedSearchesListPage.getFavoritedSearchCard(name),
        ).toBeHidden();
      });
    });

    test('should favorite a saved search in list view', async ({ page }) => {
      const ts = Date.now();
      const name = `E2E Fav List Search ${ts}`;

      await test.step('Create a saved search via API', async () => {
        await createSavedSearchViaApi(page, { name });
      });

      await test.step('Switch to list view and favorite the saved search', async () => {
        await savedSearchesListPage.goto();
        await savedSearchesListPage.switchToListView();
        await savedSearchesListPage.toggleFavoriteOnRow(name);
      });

      await test.step('Verify the favorites section appears with the saved search', async () => {
        await expect(savedSearchesListPage.getFavoritesSection()).toBeVisible();
        await expect(
          savedSearchesListPage.getFavoritedSearchCard(name),
        ).toBeVisible();
      });
    });

    test('should persist favorites across page reloads', async ({ page }) => {
      const ts = Date.now();
      const name = `E2E Persist Fav Search ${ts}`;

      await test.step('Create and favorite a saved search', async () => {
        await createSavedSearchViaApi(page, { name });
        await savedSearchesListPage.goto();
        await savedSearchesListPage.toggleFavoriteOnCard(name);
        await expect(
          savedSearchesListPage.getFavoritedSearchCard(name),
        ).toBeVisible();
      });

      await test.step('Reload the page and verify favorite persists', async () => {
        await savedSearchesListPage.goto();
        await expect(savedSearchesListPage.getFavoritesSection()).toBeVisible();
        await expect(
          savedSearchesListPage.getFavoritedSearchCard(name),
        ).toBeVisible();
      });
    });

    test('should show favorited saved search in sidebar and navigate to it', async ({
      page,
    }) => {
      const ts = Date.now();
      const name = `E2E Sidebar Search ${ts}`;

      await test.step('Create a saved search via API', async () => {
        await createSavedSearchViaApi(page, { name });
      });

      await test.step('Favorite the saved search', async () => {
        await savedSearchesListPage.goto();
        await savedSearchesListPage.toggleFavoriteOnCard(name);
      });

      await test.step('Verify the sidebar shows the favorited saved search', async () => {
        const sidebarLink = page
          .locator('a[href^="/search/"]')
          .filter({ hasText: name });
        await expect(sidebarLink).toBeVisible();
      });

      await test.step('Click the sidebar link and verify navigation', async () => {
        const sidebarLink = page
          .locator('a[href^="/search/"]')
          .filter({ hasText: name });
        await sidebarLink.click();
        await page.waitForURL('**/search/**');
        expect(page.url()).toContain('/search/');
      });
    });
  },
);
