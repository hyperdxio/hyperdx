// tests/dashboards/dashboard.spec.ts
import { expect, Page, test } from '@playwright/test';

import {
  createDashboardChart,
  deleteDashboard,
} from '../utils/dashboardHelper';
import login from '../utils/loginHelper';

test('Test create saved dashboard', async ({ page }: { page: Page }) => {
  await login(page);

  // Navigate to dashboards page
  await page.goto('http://localhost:8080/dashboards');

  // Check if create dashboard button exists
  const createDashboardBtn = page.locator(
    '[data-testid="create-dashboard-button"]',
  );
  await expect(createDashboardBtn).toBeVisible();

  // Click create dashboard button
  await createDashboardBtn.click();

  // Wait for the dashboard page at /dashboards/{id} to load
  await page.waitForURL('**/dashboards/**');

  // Create a chart with minimal options
  await createDashboardChart(page, {
    name: 'Simple Chart',
    dataSource: 'Logs',
  });

  //Create another chart with more options
  await createDashboardChart(page, {
    name: 'Advanced Chart',
    dataSource: 'Metrics',
    //chartType: 'Line Chart',
    where: 'ServiceName:api',
    //groupBy: 'ServiceName',
    //timeRange: 'Past 1h'
  });

  // Add a third chart but cancel with Escape
  const addNewTileBtn = page.locator('[data-testid="add-new-tile-button"]');
  await expect(addNewTileBtn).toBeVisible();
  await addNewTileBtn.click();

  const dlg = page.locator('role=dialog');
  await expect(dlg).toBeVisible();

  // press escape key and expect close
  await page.keyboard.press('Escape');
  await expect(dlg).toBeHidden();

  // delete dashboard
  await deleteDashboard(page);
});

test('Test dashboard chart interactions', async ({ page }: { page: Page }) => {
  await login(page);

  // Go to dashboards page
  await page.goto('http://localhost:8080/dashboards');

  // Open first dashboard if available
  const firstDashboard = page.locator('[data-testid="dashboard-item"]').first();
  if ((await firstDashboard.count()) > 0) {
    await firstDashboard.click();

    // Wait for dashboard to load
    await page.waitForURL('**/dashboards/**');

    // Find the first chart and test zoom controls
    const chart = page.locator('[data-testid="dashboard-chart"]').first();
    if ((await chart.count()) > 0) {
      // Test chart menu
      const chartMenu = chart.locator('[data-testid="chart-menu"]');
      await chartMenu.click();

      // Check menu options
      const menuOptions = page.locator('[data-testid="chart-menu-option"]');
      await expect(menuOptions).toBeVisible();

      // Close menu by clicking outside
      await page.mouse.click(0, 0);
    }
  }
});
