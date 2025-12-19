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
    // Wait for initial data to load (charts, tables, etc.)
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Switch to a specific tab (Pod, Node, Namespaces)
   */
  async switchToTab(tabName: string) {
    await this.page.getByRole('tab', { name: tabName }).click();
    // Wait for tab content to load (charts, tables, etc.)
    await this.page.waitForLoadState('networkidle');
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

    // Wait for network to settle first - ensures table data is fully loaded
    // and React won't re-render and replace DOM elements
    await this.page.waitForLoadState('networkidle');

    // Now get the row reference (after table is stable)
    const firstPodRow = podsTable
      .getByRole('row', { name: new RegExp(status) })
      .first();

    // Wait for the row to be visible and actionable
    await firstPodRow.waitFor({ state: 'visible', timeout: 2000 });

    // Scroll into view if needed
    await firstPodRow.scrollIntoViewIfNeeded();

    await firstPodRow.click();

    // Wait for details panel to load
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Click on first node row
   * Waits for table to load and row to be visible before clicking
   */
  async clickFirstNodeRow() {
    const nodesTable = this.getNodesTable();

    // Wait for network to settle first - ensures table data is fully loaded
    // and React won't re-render and replace DOM elements
    await this.page.waitForLoadState('networkidle');

    // Match row by content (Ready/Not Ready status) to avoid virtual list padding rows
    const firstNodeRow = nodesTable
      .getByRole('row', { name: /Ready/i })
      .first();

    // Wait for the row to be visible and actionable
    await firstNodeRow.waitFor({ state: 'visible', timeout: 5000 });

    // Scroll into view if needed
    await firstNodeRow.scrollIntoViewIfNeeded();

    await firstNodeRow.click();

    // Wait for details panel to load
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Click on namespace row
   */
  async clickNamespaceRow(namespace: string) {
    // Wait for network to settle first
    await this.page.waitForLoadState('networkidle');

    const namespaceRow = this.getNamespacesTable().getByRole('row', {
      name: new RegExp(namespace),
    });
    await namespaceRow.click();

    // Wait for details panel to load
    await this.page.waitForLoadState('networkidle');
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
