import { expect, Page } from '@playwright/test';

export type ChartOptions = {
  name: string;
  dataSource: string;
  chartType?: string;
  where?: string;
  groupBy?: string;
  timeRange?: string;
};

export async function deleteDashboard(page: Page) {
  const dashboardMenu = page.locator('[data-testid="dashboard-menu"]');
  await expect(dashboardMenu).toBeVisible();
  await dashboardMenu.click();

  const deleteDashboardBtn = page.locator(
    '[data-testid="delete-dashboard-button"]',
  );
  await expect(deleteDashboardBtn).toBeVisible();
  await deleteDashboardBtn.click();
  // check redirected to http://localhost:8080/dashboards
  await expect(page).toHaveURL('http://localhost:8080/dashboards');
}

export async function createDashboardChart(
  page: Page,
  options: ChartOptions,
): Promise<void> {
  // Open chart creation modal
  const addNewTileBtn = page.locator('[data-testid="add-new-tile-button"]');
  await expect(addNewTileBtn).toBeVisible();
  await addNewTileBtn.click();

  // Wait for the modal
  const dlg = page.locator('role=dialog');
  await expect(dlg).toBeVisible();

  // Set chart name
  const chartNameInput = page.locator('[data-testid="chart-name-input"]');
  await expect(chartNameInput).toBeVisible();
  await chartNameInput.fill(options.name);

  // Select data source
  const dataSourceSelect = page.locator('[data-testid="data-source-select"]');
  await expect(dataSourceSelect).toBeVisible();
  await dataSourceSelect.click();
  await page.locator('role=option', { hasText: options.dataSource }).click();

  // Select chart type if provided
  if (options.chartType) {
    const chartTypeSelect = page.locator('[data-testid="chart-type-select"]');
    await expect(chartTypeSelect).toBeVisible();
    await chartTypeSelect.click();
    await page.locator('role=option', { hasText: options.chartType }).click();
  }

  // Enter SQL query if provided
  if (options.where) {
    const queryEditor = page.locator('[data-testid="where-lucene-editor"]');
    await expect(queryEditor).toBeVisible();
    await queryEditor.fill(options.where);
  }

  // Set group by if provided
  if (options.groupBy) {
    const groupBySelect = page.locator('[data-testid="group-by-select"]');
    await expect(groupBySelect).toBeVisible();
    await groupBySelect.click();
    await page.locator('role=option', { hasText: options.groupBy }).click();
  }

  // Set time range if provided
  if (options.timeRange) {
    const timeRangeSelect = page.locator('[data-testid="time-range-select"]');
    await expect(timeRangeSelect).toBeVisible();
    await timeRangeSelect.click();
    await page.locator('role=option', { hasText: options.timeRange }).click();
  }

  // Save chart
  const saveChartBtn = page.locator('[data-testid="save-chart-button"]');
  await expect(saveChartBtn).toBeVisible();
  await saveChartBtn.click();

  // Wait for dialog to close
  await expect(dlg).toBeHidden();
}
