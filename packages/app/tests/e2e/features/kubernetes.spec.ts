import { KubernetesPage } from '../page-objects/KubernetesPage';
import { expect, test } from '../utils/base-test';

test.describe('Kubernetes Dashboard', { tag: ['@kubernetes'] }, () => {
  let k8sPage: KubernetesPage;

  test.beforeEach(async ({ page }) => {
    k8sPage = new KubernetesPage(page);
    await k8sPage.goto();
  });

  test('should load kubernetes dashboard', async () => {
    await expect(k8sPage.title).toBeVisible();
  });

  test('should show pod details', async () => {
    // Verify pod CPU and memory charts
    const cpuUsageChart = k8sPage.getChart('pod-cpu-usage-chart');
    await expect(cpuUsageChart).toBeVisible();

    const memoryUsageChart = k8sPage.getChart('pod-memory-usage-chart');
    await expect(memoryUsageChart).toBeVisible();

    // Verify pods table has data
    const podsTable = k8sPage.getPodsTable();
    await expect(podsTable.locator('tr td').first()).toBeVisible();

    // Verify warning events table
    const warningEventsTable = k8sPage.page.locator(
      '[data-testid="k8s-warning-events-table"] table',
    );
    await expect(warningEventsTable).toContainText('Warning');
    await expect(warningEventsTable).toContainText('Node');

    // Click first pod row
    await k8sPage.clickFirstPodRow('Running');

    // Verify pod details panel opens
    const podDetailsPanel = k8sPage.getDetailsPanel('k8s-pod-details-panel');
    await expect(podDetailsPanel).toBeVisible();

    // Verify pod details charts
    const podDetailsCpuChart = k8sPage.getChart('pod-details-cpu-usage-chart');
    await expect(podDetailsCpuChart).toBeVisible();

    const podDetailsMemoryChart = k8sPage.getChart(
      'pod-details-memory-usage-chart',
    );
    await expect(podDetailsMemoryChart).toBeVisible();
  });

  test('should show node metrics', async () => {
    // Switch to Node tab
    await k8sPage.switchToTab('Node');

    // Verify node CPU and memory charts
    const cpuUsageChart = k8sPage.getChart('nodes-cpu-usage-chart');
    await expect(cpuUsageChart).toBeVisible();

    const memoryUsageChart = k8sPage.getChart('nodes-memory-usage-chart');
    await expect(memoryUsageChart).toBeVisible();

    // Click first node row
    await k8sPage.clickFirstNodeRow();

    // Verify node details panel opens
    const nodeDetailsPanel = k8sPage.getDetailsPanel('k8s-node-details-panel');
    await expect(nodeDetailsPanel).toBeVisible();

    // Verify node details charts
    const nodeDetailsCpuChart = k8sPage.getChart(
      'nodes-details-cpu-usage-chart',
    );
    await expect(nodeDetailsCpuChart).toBeVisible();

    const nodeDetailsMemoryChart = k8sPage.getChart(
      'nodes-details-memory-usage-chart',
    );
    await expect(nodeDetailsMemoryChart).toBeVisible();
  });

  test('should show namespace metrics', async () => {
    // Switch to Namespaces tab
    await k8sPage.switchToTab('Namespaces');

    // Verify namespace CPU and memory charts
    const cpuUsageChart = k8sPage.getChart('namespaces-cpu-usage-chart');
    await expect(cpuUsageChart).toBeVisible();

    const memoryUsageChart = k8sPage.getChart('namespaces-memory-usage-chart');
    await expect(memoryUsageChart).toBeVisible();

    // Verify namespaces table has data
    const namespacesTable = k8sPage.getNamespacesTable();
    await expect(namespacesTable.locator('tr td').first()).toBeVisible();

    // Click default namespace row
    await k8sPage.clickNamespaceRow('default');

    // Verify namespace details panel opens
    const namespaceDetailsPanel = k8sPage.getDetailsPanel(
      'k8s-namespace-details-panel',
    );
    await expect(namespaceDetailsPanel).toBeVisible();

    // Verify namespace details charts
    const namespaceDetailsCpuChart = k8sPage.getChart(
      'namespace-details-cpu-usage-chart',
    );
    await expect(namespaceDetailsCpuChart).toBeVisible();

    const namespaceDetailsMemoryChart = k8sPage.getChart(
      'namespace-details-memory-usage-chart',
    );
    await expect(namespaceDetailsMemoryChart).toBeVisible();
  });

  test('should filter by namespace', async () => {
    // Filter by default namespace
    await k8sPage.filterByNamespace('default');

    // Verify pods are filtered to default namespace
    const firstPodNamespaceCell = k8sPage.page
      .locator('[data-testid^="k8s-pods-table-namespace-"]')
      .first();
    await expect(firstPodNamespaceCell).toBeVisible();
    await expect(firstPodNamespaceCell).toContainText('default');

    // Verify search box has filter query
    await expect(k8sPage.search).toHaveValue(
      'ResourceAttributes.k8s.namespace.name:"default"',
    );
  });

  test('should switch to "All" tab when filtering by pod or namespace', async () => {
    // Verify initial state is "Running"
    const podsTable = k8sPage.getPodsTable();

    // Wait for table to load
    await expect(podsTable.locator('tbody tr').first()).toBeVisible();

    const runningTab = podsTable.getByRole('radio', { name: 'Running' });
    await expect(runningTab).toBeChecked();

    // Filter by namespace
    await k8sPage.filterByNamespace('default');

    // Verify it switched to "All" tab
    const allTab = podsTable.getByRole('radio', { name: 'All' });
    await expect(allTab).toBeChecked();
  });

  test.describe('Pods Table Sorting', () => {
    // Currently the data sources all have 0 restarts, so this test fails.
    // eslint-disable-next-line playwright/no-skipped-test
    test.skip('should sort by restarts column', async () => {
      const podsTable = k8sPage.getPodsTable();
      await expect(podsTable.locator('tbody tr').first()).toBeVisible();

      const restartsHeader = k8sPage.getColumnHeader(podsTable, 'Restarts');

      // Verify initial descending sort icon
      await expect(k8sPage.getDescendingSortIcon(restartsHeader)).toBeVisible({
        timeout: 10000,
      });

      const firstRestartsBefore = await k8sPage.getFirstCellValue(
        podsTable,
        'Restarts',
      );

      // Click to sort ascending
      await k8sPage.sortByColumn(podsTable, 'Restarts');

      // Verify sort icon changed to ascending
      await expect(k8sPage.getAscendingSortIcon(restartsHeader)).toBeVisible();

      const firstRestartsAfter = await k8sPage.getFirstCellValue(
        podsTable,
        'Restarts',
      );

      expect(firstRestartsBefore).not.toEqual(firstRestartsAfter);
    });

    // Parametrized test for common sorting behavior
    const sortableColumns = [
      { name: 'Status', hasInitialSort: false },
      { name: 'CPU/Limit', hasInitialSort: false },
      { name: 'Mem/Limit', hasInitialSort: false },
      { name: 'Age', hasInitialSort: false },
    ];

    for (const column of sortableColumns) {
      test(`should sort by ${column.name} column`, async () => {
        const podsTable = k8sPage.getPodsTable();
        await expect(podsTable.locator('tbody tr').first()).toBeVisible();

        const header = k8sPage.getColumnHeader(podsTable, column.name);
        const sortIcon = k8sPage.getSortIcon(header);

        // Verify no sort icon initially (unless specified)
        if (!column.hasInitialSort) {
          await expect(sortIcon).toHaveCount(0);
        }

        // Click to sort
        await k8sPage.sortByColumn(podsTable, column.name);

        // Verify sort icon appears
        await expect(sortIcon).toBeVisible();

        // Click again to toggle sort direction
        await k8sPage.sortByColumn(podsTable, column.name);

        // Sort icon should still be visible
        await expect(sortIcon).toBeVisible();
      });
    }

    test('should maintain sort when switching phase filters', async () => {
      const podsTable = k8sPage.getPodsTable();
      await expect(podsTable.locator('tbody tr').first()).toBeVisible();

      // Sort by age
      const ageHeader = await k8sPage.sortByColumn(podsTable, 'Age');
      const sortIcon = k8sPage.getSortIcon(ageHeader);
      await expect(sortIcon).toBeVisible();

      // Switch to "All" tab
      await podsTable.getByText('All', { exact: true }).click();

      // Sort should be maintained
      await expect(sortIcon).toBeVisible();
    });
  });
});
