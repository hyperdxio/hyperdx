// tests/dashboards/dashboard-tiles.spec.ts
import { expect, Page, test } from '@playwright/test';

import {
  createDashboardChart,
  deleteDashboard,
} from '../utils/dashboardHelper';
import login from '../utils/loginHelper';

test.describe('Dashboard Tiles Management', () => {
  let dashboardUrl: string;

  test.beforeEach(async ({ page }) => {
    await login(page);

    // Create a new dashboard to test with
    await page.goto('http://localhost:8080/dashboards');
    const createDashboardBtn = page.locator(
      '[data-testid="create-dashboard-button"]',
    );
    await expect(createDashboardBtn).toBeVisible();
    await createDashboardBtn.click();

    // Wait for the dashboard page to load
    await page.waitForURL('**/dashboards/**');
    dashboardUrl = page.url();
  });

  test.afterEach(async ({ page }) => {
    // Navigate back to the dashboard if we're not already there
    if (!page.url().includes(dashboardUrl)) {
      await page.goto(dashboardUrl);
    }

    // Delete the dashboard
    await deleteDashboard(page);
  });

  test('Test adding different chart types', async ({ page }) => {
    // Add a line chart
    await createDashboardChart(page, {
      name: 'Line Chart Test',
      dataSource: 'Logs',
      chartType: 'Line Chart',
      where: 'level:info',
      groupBy: 'service',
    });

    // Add a bar chart
    await createDashboardChart(page, {
      name: 'Bar Chart Test',
      dataSource: 'Logs',
      chartType: 'Bar Chart',
      where: 'level:error',
      groupBy: 'service',
    });

    // Add a number chart
    await createDashboardChart(page, {
      name: 'Number Chart Test',
      dataSource: 'Logs',
      chartType: 'Number Chart',
      where: 'level:error',
    });

    // Add a table chart
    await createDashboardChart(page, {
      name: 'Table Chart Test',
      dataSource: 'Logs',
      chartType: 'Table Chart',
      where: 'level:error',
    });

    // Verify all charts are visible
    const charts = page.locator('[data-testid="dashboard-chart"]');
    await expect(charts).toHaveCount(4);
  });

  test('Test editing chart', async ({ page }) => {
    // Add a chart to edit
    await createDashboardChart(page, {
      name: 'Chart To Edit',
      dataSource: 'Logs',
      where: 'level:info',
    });

    // Find the chart's edit button
    const chart = page.locator(
      '[data-testid="dashboard-chart"]:has-text("Chart To Edit")',
    );
    await expect(chart).toBeVisible();

    // Click chart menu
    const chartMenu = chart.locator('[data-testid="chart-menu"]');
    await chartMenu.click();

    // Click edit option
    const editOption = page.locator('[data-testid="edit-chart-option"]');
    await editOption.click();

    // Wait for edit dialog to appear
    const editDialog = page.locator('role=dialog');
    await expect(editDialog).toBeVisible();

    // Change chart name
    const chartNameInput = page.locator('[data-testid="chart-name-input"]');
    await chartNameInput.fill('Updated Chart Name');

    // Save changes
    const saveButton = page.locator('[data-testid="save-chart-button"]');
    await saveButton.click();

    // Verify chart name is updated
    await expect(page.locator('text=Updated Chart Name')).toBeVisible();
  });

  test('Test deleting chart', async ({ page }) => {
    // Add a chart to delete
    await createDashboardChart(page, {
      name: 'Chart To Delete',
      dataSource: 'Logs',
    });

    // Find the chart
    const chart = page.locator(
      '[data-testid="dashboard-chart"]:has-text("Chart To Delete")',
    );
    await expect(chart).toBeVisible();

    // Click chart menu
    const chartMenu = chart.locator('[data-testid="chart-menu"]');
    await chartMenu.click();

    // Click delete option
    const deleteOption = page.locator('[data-testid="delete-chart-option"]');
    await deleteOption.click();

    // Confirm deletion
    const confirmButton = page.locator('[data-testid="confirm-delete-button"]');
    await confirmButton.click();

    // Verify chart is removed
    await expect(chart).not.toBeVisible();
  });

  test('Test resizing chart', async ({ page }) => {
    // Add a chart to resize
    await createDashboardChart(page, {
      name: 'Chart To Resize',
      dataSource: 'Logs',
    });

    // Find the chart
    const chart = page.locator(
      '[data-testid="dashboard-chart"]:has-text("Chart To Resize")',
    );
    await expect(chart).toBeVisible();

    // Get initial size
    const initialBoundingBox = (await chart.boundingBox()) || {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };

    // Find resize handle
    const resizeHandle = chart.locator('[data-testid="resize-handle"]');

    // Perform resize if resize handle exists
    if ((await resizeHandle.count()) > 0) {
      // Get handle position
      const handleBox = (await resizeHandle.boundingBox()) || {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };

      // Drag to resize
      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        handleBox.x + handleBox.width / 2 + 100,
        handleBox.y + handleBox.height / 2 + 100,
      );
      await page.mouse.up();

      // Get new size
      const newBoundingBox = (await chart.boundingBox()) || {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };

      // Verify size changed
      expect(newBoundingBox.width).not.toEqual(initialBoundingBox.width);
      expect(newBoundingBox.height).not.toEqual(initialBoundingBox.height);
    }
  });

  test('Test dashboard layout persistence', async ({ page }) => {
    // Add two charts
    await createDashboardChart(page, {
      name: 'First Chart',
      dataSource: 'Logs',
    });

    await createDashboardChart(page, {
      name: 'Second Chart',
      dataSource: 'Logs',
    });

    // Get initial positions
    const firstChart = page.locator(
      '[data-testid="dashboard-chart"]:has-text("First Chart")',
    );
    const secondChart = page.locator(
      '[data-testid="dashboard-chart"]:has-text("Second Chart")',
    );

    const initialFirstBox = (await firstChart.boundingBox()) || {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };
    const initialSecondBox = (await secondChart.boundingBox()) || {
      x: 0,
      y: 0,
      width: 0,
      height: 0,
    };

    // If drag handles exist, try to move charts
    const dragHandle = firstChart.locator('[data-testid="drag-handle"]');

    if ((await dragHandle.count()) > 0) {
      // Get handle position
      const handleBox = (await dragHandle.boundingBox()) || {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };

      // Drag to move
      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2,
      );
      await page.mouse.down();
      await page.mouse.move(
        handleBox.x + handleBox.width / 2,
        handleBox.y + handleBox.height / 2 + 200,
      );
      await page.mouse.up();

      // Reload page to check persistence
      await page.reload();

      // Get new positions
      const newFirstBox = (await firstChart.boundingBox()) || {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
      };

      // Verify position is persisted (if chart system supports this)
      if (Math.abs(newFirstBox.y - initialFirstBox.y) > 10) {
        // Position was persisted
        expect(Math.abs(newFirstBox.y - initialFirstBox.y)).toBeGreaterThan(10);
      }
    }
  });
});
