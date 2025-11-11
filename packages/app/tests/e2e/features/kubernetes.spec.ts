import type { Locator, Page } from '@playwright/test';

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

  test('should switch to "All" tab when filtering by pod or namespace', async ({
    page,
  }) => {
    // Verify initial state is "Running"
    const podsTable = page.getByTestId('k8s-pods-table');

    // Wait for table to load
    await expect(podsTable.locator('tbody tr').first()).toBeVisible();

    const runningTab = podsTable.getByRole('radio', { name: 'Running' });
    await expect(runningTab).toBeChecked();

    // Filter by namespace
    const namespaceFilter = page.getByTestId('namespace-filter-select');
    await namespaceFilter.click();
    await page.getByRole('option', { name: 'default' }).click();

    await page.waitForTimeout(500);

    // Verify it switched to "All" tab
    const allTab = podsTable.getByRole('radio', { name: 'All' });
    await expect(allTab).toBeChecked();
  });

  test.describe('Pods Table Sorting', () => {
    const SORT_ICON_SELECTOR = 'i.bi-caret-down-fill, i.bi-caret-up-fill';

    async function waitForTableLoad(page: Page): Promise<Locator> {
      const podsTable = page.getByTestId('k8s-pods-table');
      await expect(podsTable.locator('tbody tr').first()).toBeVisible();
      return podsTable;
    }

    function getColumnHeader(podsTable: Locator, columnName: string): Locator {
      return podsTable.locator('thead th').filter({ hasText: columnName });
    }

    function getSortIcon(header: Locator): Locator {
      return header.locator(SORT_ICON_SELECTOR);
    }

    test('should sort by restarts column', async ({ page }) => {
      const podsTable = await waitForTableLoad(page);
      const restartsHeader = getColumnHeader(podsTable, 'Restarts');

      await expect(restartsHeader.locator('i.bi-caret-down-fill')).toBeVisible({
        timeout: 10000,
      });

      const firstRestartsBefore = await podsTable
        .locator('tbody tr')
        .first()
        .locator('td')
        .last()
        .textContent();

      await restartsHeader.click();
      await page.waitForTimeout(500);

      await expect(restartsHeader.locator('i.bi-caret-up-fill')).toBeVisible();

      const firstRestartsAfter = await podsTable
        .locator('tbody tr')
        .first()
        .locator('td')
        .last()
        .textContent();

      expect(firstRestartsBefore).not.toBe(firstRestartsAfter);
    });

    test('should sort by status column', async ({ page }) => {
      const podsTable = await waitForTableLoad(page);
      const statusHeader = getColumnHeader(podsTable, 'Status');
      const sortIcon = getSortIcon(statusHeader);

      await expect(sortIcon).toHaveCount(0);

      await statusHeader.click();
      await page.waitForTimeout(500);

      await expect(sortIcon).toBeVisible();
    });

    test('should sort by CPU/Limit column', async ({ page }) => {
      const podsTable = await waitForTableLoad(page);
      const cpuLimitHeader = getColumnHeader(podsTable, 'CPU/Limit');
      const sortIcon = getSortIcon(cpuLimitHeader);

      await cpuLimitHeader.click();
      await page.waitForTimeout(500);

      await expect(sortIcon).toBeVisible();

      await cpuLimitHeader.click();
      await page.waitForTimeout(500);

      await expect(sortIcon).toBeVisible();
    });

    test('should sort by Memory/Limit column', async ({ page }) => {
      const podsTable = await waitForTableLoad(page);
      const memLimitHeader = getColumnHeader(podsTable, 'Mem/Limit');

      await memLimitHeader.click();
      await page.waitForTimeout(500);

      await expect(getSortIcon(memLimitHeader)).toBeVisible();
    });

    test('should sort by Age column', async ({ page }) => {
      const podsTable = await waitForTableLoad(page);
      const ageHeader = getColumnHeader(podsTable, 'Age');

      await ageHeader.click();
      await page.waitForTimeout(500);

      await expect(getSortIcon(ageHeader)).toBeVisible();
    });

    test('should maintain sort when switching phase filters', async ({
      page,
    }) => {
      const podsTable = await waitForTableLoad(page);
      const ageHeader = getColumnHeader(podsTable, 'Age');
      const sortIcon = getSortIcon(ageHeader);

      await ageHeader.click();
      await page.waitForTimeout(500);

      await expect(sortIcon).toBeVisible();

      await podsTable.getByText('All', { exact: true }).click();
      await page.waitForTimeout(500);

      await expect(sortIcon).toBeVisible();
    });
  });
});
