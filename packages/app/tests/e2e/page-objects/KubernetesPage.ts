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
   */
  async clickFirstPodRow(status: string = 'Running') {
    const firstPodRow = this.page
      .getByTestId('k8s-pods-table')
      .getByRole('row', { name: new RegExp(status) })
      .first();
    await firstPodRow.click();
  }

  /**
   * Click on first node row
   */
  async clickFirstNodeRow() {
    const firstNodeRow = this.page
      .getByTestId('k8s-nodes-table')
      .getByRole('row')
      .nth(1);
    await firstNodeRow.click();
  }

  /**
   * Click on namespace row
   */
  async clickNamespaceRow(namespace: string) {
    const namespaceRow = this.page
      .getByTestId('k8s-namespaces-table')
      .getByRole('row', { name: new RegExp(namespace) });
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
