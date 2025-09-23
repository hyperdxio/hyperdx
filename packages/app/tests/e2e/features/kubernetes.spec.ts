import { expect, test } from '../utils/base-test';

test.describe('Kubernetes Dashboard', { tag: ['@kubernetes'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/kubernetes');
    await page.waitForLoadState('networkidle');
  });

  test('should load kubernetes dashboard', async ({ page }) => {
    const dashboardTitle = await page.getByText('Kubernetes Dashboard');
    expect(dashboardTitle).toBeVisible();
  });

  test('should show pod details', async ({ page }) => {
    const cpuUsageChart = page
      .locator('[data-testid="pod-cpu-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(cpuUsageChart).toBeVisible();

    const memoryUsageChart = page
      .locator('[data-testid="pod-memory-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(memoryUsageChart).toBeVisible();

    const podsTableData = page.locator('[data-testid="k8s-pods-table"] tr td');
    await expect(podsTableData.first()).toBeVisible();

    const warningEventsTable = page.locator(
      '[data-testid="k8s-warning-events-table"] table',
    );
    await expect(warningEventsTable).toContainText('Warning');
    await expect(warningEventsTable).toContainText('Node');

    const firstPodRow = await page
      .getByTestId('k8s-pods-table')
      .getByRole('row', { name: /Running/ })
      .first();
    await firstPodRow.click();

    const podDetailsPanel = page.locator(
      '[data-testid="k8s-pod-details-panel"]',
    );
    await expect(podDetailsPanel).toBeVisible();

    const podDetailsCpuUsageChart = page
      .locator('[data-testid="pod-details-cpu-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(podDetailsCpuUsageChart).toBeVisible();

    const podDetailsMemoryUsageChart = page
      .locator('[data-testid="pod-details-memory-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(podDetailsMemoryUsageChart).toBeVisible();
  });

  test('should show node metrics', async ({ page }) => {
    await page.getByRole('tab', { name: 'Node' }).click();

    const cpuUsageChart = page
      .locator('[data-testid="nodes-cpu-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(cpuUsageChart).toBeVisible();

    const memoryUsageChart = page
      .locator('[data-testid="nodes-memory-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(memoryUsageChart).toBeVisible();

    await page.waitForTimeout(1000);

    const firstNodeRow = await page
      .getByTestId('k8s-nodes-table')
      .getByRole('row')
      .nth(1);
    await firstNodeRow.click();

    const nodeDetailsPanel = page.locator(
      '[data-testid="k8s-node-details-panel"]',
    );
    await expect(nodeDetailsPanel).toBeVisible();

    const nodeDetailsCpuUsageChart = page
      .locator('[data-testid="nodes-details-cpu-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(nodeDetailsCpuUsageChart).toBeVisible();

    const nodeDetailsMemoryUsageChart = page
      .locator('[data-testid="nodes-details-memory-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(nodeDetailsMemoryUsageChart).toBeVisible();
  });

  test('should show namespace metrics', async ({ page }) => {
    await page.getByRole('tab', { name: 'Namespaces' }).click();

    const cpuUsageChart = page
      .locator('[data-testid="namespaces-cpu-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(cpuUsageChart).toBeVisible();

    const memoryUsageChart = page
      .locator('[data-testid="namespaces-memory-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(memoryUsageChart).toBeVisible();

    const nodesTableData = page.locator(
      '[data-testid="k8s-namespaces-table"] tr td',
    );
    await expect(nodesTableData.first()).toBeVisible();

    const defaultRow = await page
      .getByTestId('k8s-namespaces-table')
      .getByRole('row', { name: /default/ });
    await expect(defaultRow).toBeVisible();
    await defaultRow.click();

    const namespaceDetailsPanel = page.locator(
      '[data-testid="k8s-namespace-details-panel"]',
    );
    await expect(namespaceDetailsPanel).toBeVisible();

    const namespaceDetailsCpuUsageChart = page
      .locator('[data-testid="namespace-details-cpu-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(namespaceDetailsCpuUsageChart).toBeVisible();

    const namespaceDetailsMemoryUsageChart = page
      .locator('[data-testid="namespace-details-memory-usage-chart"]')
      .locator('.recharts-responsive-container');
    await expect(namespaceDetailsMemoryUsageChart).toBeVisible();
  });

  test('should filter by namespace', async ({ page }) => {
    const namespaceFilter = page.getByTestId('namespace-filter-select');
    await namespaceFilter.click();
    await page.getByRole('option', { name: 'default' }).click();

    await page.waitForTimeout(1000);

    const firstPodNamespaceCell = page
      .locator('[data-testid^="k8s-pods-table-namespace-"]')
      .first();
    await expect(firstPodNamespaceCell).toBeVisible();
    await expect(firstPodNamespaceCell).toContainText('default');

    const searchBox = page.getByTestId('k8s-search-input');
    await expect(searchBox).toHaveValue(
      'ResourceAttributes.k8s.namespace.name:"default"',
    );
  });
});
