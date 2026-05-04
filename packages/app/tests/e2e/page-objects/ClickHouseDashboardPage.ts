/**
 * ClickHouseDashboardPage - Page object for the /clickhouse dashboard page
 * Encapsulates interactions with the ClickHouse system dashboard
 */
import { Locator, Page } from '@playwright/test';

export class ClickHouseDashboardPage {
  readonly page: Page;
  private readonly _pageContainer: Locator;
  private readonly _queryLatencyChart: Locator;
  private readonly _connectionSelect: Locator;

  constructor(page: Page) {
    this.page = page;
    this._pageContainer = page.getByTestId('clickhouse-dashboard-page');
    // Scope heatmap locators to the chart container with the "Query Latency" title
    this._queryLatencyChart = this._pageContainer
      .locator('div')
      .filter({ hasText: 'Query Latency' })
      .first();
    this._connectionSelect = page.getByPlaceholder('Connection');
  }

  async goto() {
    await this.page.goto('/clickhouse');
  }

  async selectConnection(connectionName: string) {
    await this._connectionSelect.click();
    const option = this.page.getByRole('option', { name: connectionName });
    await option.click();
  }

  async waitForPageLoad() {
    await this._pageContainer.waitFor({ state: 'visible' });
  }

  get container(): Locator {
    return this._pageContainer;
  }

  get queryLatencyChart(): Locator {
    return this._queryLatencyChart.locator('.uplot');
  }
}
