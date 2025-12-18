/**
 * KubernetesPage - Page object for the /kubernetes page
 * Encapsulates all interactions with the Kubernetes dashboard interface
 */
import { Locator, Page } from '@playwright/test';

export class KubernetesPage {
  readonly page: Page;
  private readonly dashboardTitle: Locator;
  private readonly namespaceFilter: Locator;
  private readonly searchInput: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dashboardTitle = page.getByText('Kubernetes Dashboard');
    this.namespaceFilter = page.getByTestId('namespace-filter-select');
    this.searchInput = page.getByTestId('k8s-search-input');
  }

  /**
   * Navigate to the Kubernetes dashboard page
   */
  async goto() {
    await this.page.goto('/kubernetes');
  }

  /**
   * Switch to a specific tab (Pod, Node, Namespaces)
   */
  async switchToTab(tabName: string) {
    await this.page.getByRole('tab', { name: tabName }).click();
  }

  /**
   * Filter by namespace
   */
  async filterByNamespace(namespace: string) {
    await this.namespaceFilter.click();
    await this.page.getByRole('option', { name: namespace }).click();
  }

  /**
   * Get pods table
   */
  getPodsTable() {
    return this.page.getByTestId('k8s-pods-table');
  }

  /**
   * Get nodes table
   */
  getNodesTable() {
    return this.page.getByTestId('k8s-nodes-table');
  }

  /**
   * Get namespaces table
   */
  getNamespacesTable() {
    return this.page.getByTestId('k8s-namespaces-table');
  }

  /**
   * Get chart by test ID
   */
  getChart(chartTestId: string) {
    return this.page
      .locator(`[data-testid="${chartTestId}"]`)
      .locator('.recharts-responsive-container');
  }

  /**
   * Get details panel by test ID
   */
  getDetailsPanel(panelTestId: string) {
    return this.page.locator(`[data-testid="${panelTestId}"]`);
  }

  /**
   * Click on first pod row with specific status
   * Waits for table to load and row to be visible before clicking
   */
  async clickFirstPodRow(status: string = 'Running') {
    const podsTable = this.getPodsTable();

    // Wait for at least one row with the status to be visible
    const firstPodRow = podsTable
      .getByRole('row', { name: new RegExp(status) })
      .first();

    // Explicitly wait for the row to be visible and actionable
    await firstPodRow.waitFor({ state: 'visible', timeout: 3000 });

    // Scroll into view if needed
    await firstPodRow.scrollIntoViewIfNeeded();

    await firstPodRow.click();
  }

  /**
   * Click on first node row
   * Waits for table to load and row to be visible before clicking
   */
  async clickFirstNodeRow() {
    const nodesTable = this.getNodesTable();

    // Wait for table to have at least one data row (skip header row at index 0)
    const firstNodeRow = nodesTable.getByRole('row').nth(1);

    // Explicitly wait for the row to be visible and actionable
    await firstNodeRow.waitFor({ state: 'visible', timeout: 10000 });

    // Scroll into view if needed
    await firstNodeRow.scrollIntoViewIfNeeded();

    // Wait for React event handlers to be attached
    // This is a workaround for tables that render before handlers are ready
    // eslint-disable-next-line playwright/no-networkidle
    await this.page.waitForLoadState('networkidle');

    await firstNodeRow.click();
  }

  /**
   * Click on namespace row
   */
  async clickNamespaceRow(namespace: string) {
    const namespaceRow = this.getNamespacesTable().getByRole('row', {
      name: new RegExp(namespace),
    });
    await namespaceRow.click();
  }

  /**
   * Get column header from a table
   */
  getColumnHeader(table: Locator, columnName: string) {
    return table.locator('thead th').filter({ hasText: columnName });
  }

  /**
   * Get sort icon from header
   */
  getSortIcon(header: Locator) {
    return header.locator(
      'svg.tabler-icon-caret-down-filled, svg.tabler-icon-caret-up-filled',
    );
  }

  /**
   * Get ascending sort icon from header
   */
  getAscendingSortIcon(header: Locator) {
    return header.locator('svg.tabler-icon-caret-up-filled');
  }

  /**
   * Get descending sort icon from header
   */
  getDescendingSortIcon(header: Locator) {
    return header.locator('svg.tabler-icon-caret-down-filled');
  }

  /**
   * Sort table by column name
   * @returns The column header locator for further assertions
   */
  async sortByColumn(table: Locator, columnName: string) {
    const header = this.getColumnHeader(table, columnName);
    await header.click();
    return header;
  }

  /**
   * Get first cell value from a column
   */
  async getFirstCellValue(table: Locator, columnName: string): Promise<string> {
    const header = this.getColumnHeader(table, columnName);
    const columnIndex = await header.evaluate(el => {
      const parent = el.parentElement;
      if (!parent) return -1;
      return Array.from(parent.children).indexOf(el);
    });

    const firstRow = table.locator('tbody tr').first();
    const cell = firstRow.locator('td').nth(columnIndex);
    return (await cell.textContent()) || '';
  }

  // Getters for assertions

  get title() {
    return this.dashboardTitle;
  }

  get namespace() {
    return this.namespaceFilter;
  }

  get search() {
    return this.searchInput;
  }
}
