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
    test('should sort by restarts column', async () => {
      const podsTable = k8sPage.getPodsTable();
      await expect(podsTable.locator('tbody tr').first()).toBeVisible();

      const restartsHeader = k8sPage.getColumnHeader(podsTable, 'Restarts');

      // Verify initial sort icon
      await expect(
        restartsHeader.locator('svg.tabler-icon-caret-down-filled'),
      ).toBeVisible({ timeout: 10000 });

      const firstRestartsBefore = podsTable
        .locator('tbody tr')
        .first()
        .locator('td')
        .last();
      // Click to sort
      await restartsHeader.click();

      // Verify sort icon changed
      await expect(
        restartsHeader.locator('svg.tabler-icon-caret-up-filled'),
      ).toBeVisible();

      const firstRestartsAfter = await podsTable
        .locator('tbody tr')
        .first()
        .locator('td')
        .last()
        .textContent();

      await expect(firstRestartsBefore).not.toHaveText(firstRestartsAfter);
    });

    test('should sort by status column', async () => {
      const podsTable = k8sPage.getPodsTable();
      await expect(podsTable.locator('tbody tr').first()).toBeVisible();

      const statusHeader = k8sPage.getColumnHeader(podsTable, 'Status');
      const sortIcon = k8sPage.getSortIcon(statusHeader);

      // No sort icon initially
      await expect(sortIcon).toHaveCount(0);

      // Click to sort
      await statusHeader.click();

      // Sort icon should appear
      await expect(sortIcon).toBeVisible();
    });

    test('should sort by CPU/Limit column', async () => {
      const podsTable = k8sPage.getPodsTable();
      await expect(podsTable.locator('tbody tr').first()).toBeVisible();

      const cpuLimitHeader = k8sPage.getColumnHeader(podsTable, 'CPU/Limit');
      const sortIcon = k8sPage.getSortIcon(cpuLimitHeader);

      // Click to sort ascending
      await cpuLimitHeader.click();
      await expect(sortIcon).toBeVisible();

      // Click to sort descending
      await cpuLimitHeader.click();
      await expect(sortIcon).toBeVisible();
    });

    test('should sort by Memory/Limit column', async () => {
      const podsTable = k8sPage.getPodsTable();
      await expect(podsTable.locator('tbody tr').first()).toBeVisible();

      const memLimitHeader = k8sPage.getColumnHeader(podsTable, 'Mem/Limit');

      await memLimitHeader.click();

      await expect(k8sPage.getSortIcon(memLimitHeader)).toBeVisible();
    });

    test('should sort by Age column', async () => {
      const podsTable = k8sPage.getPodsTable();
      await expect(podsTable.locator('tbody tr').first()).toBeVisible();

      const ageHeader = k8sPage.getColumnHeader(podsTable, 'Age');

      await ageHeader.click();

      await expect(k8sPage.getSortIcon(ageHeader)).toBeVisible();
    });

    test('should maintain sort when switching phase filters', async () => {
      const podsTable = k8sPage.getPodsTable();
      await expect(podsTable.locator('tbody tr').first()).toBeVisible();

      const ageHeader = k8sPage.getColumnHeader(podsTable, 'Age');
      const sortIcon = k8sPage.getSortIcon(ageHeader);

      // Sort by age
      await ageHeader.click();
      await expect(sortIcon).toBeVisible();

      // Switch to "All" tab
      await podsTable.getByText('All', { exact: true }).click();

      // Sort should be maintained
      await expect(sortIcon).toBeVisible();
    });
  });
});
