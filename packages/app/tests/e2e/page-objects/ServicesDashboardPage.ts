import { Locator, Page } from '@playwright/test';

export class ServicesDashboardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/services');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async selectSource(sourceName: string) {
    await this.page.getByPlaceholder('Data Source').click();
    await this.page
      .getByRole('option', { name: sourceName, exact: true })
      .click();
    await this.page.waitForLoadState('networkidle');
  }

  /** Open the filters modal. Preset-dashboard filters are broadcast-only. */
  async openEditFiltersModal() {
    await this.page.getByTestId('edit-filters-button').click();
  }

  /** The WHERE input's language switch (SQL / Lucene). */
  get whereLanguageSwitch(): Locator {
    return this.page.getByTestId('where-language-switch');
  }

  get searchInput(): Locator {
    return this.page.getByTestId('services-search-input');
  }

  /**
   * Switch to Lucene mode, type a query into the search input, and run the query.
   */
  async searchLucene(query: string) {
    await this.switchToLucene();
    await this.searchInput.fill(query);
    await this.page.getByRole('button', { name: 'Run' }).click();
    await this.page.waitForLoadState('networkidle');
  }

  async switchToLucene() {
    await this.whereLanguageSwitch
      .getByRole('combobox', { name: 'Query language' })
      .click();
    await this.page
      .getByRole('option', { name: 'Lucene', exact: true })
      .click();
  }

  /**
   * Get a row link from the "Top 20 Most Time Consuming Endpoints" table
   * by endpoint name.
   */
  async getTopEndpointsTableLink(endpointName: string) {
    const endpointLink = this.page
      .getByTestId('services-top-endpoints-table')
      .getByRole('link', { name: endpointName, exact: true })
      .first();
    return endpointLink;
  }

  get pageContainer(): Locator {
    return this.page.getByTestId('services-dashboard-page');
  }

  getChart(chartTestId: string): Locator {
    return this.page
      .getByTestId(chartTestId)
      .locator('.recharts-responsive-container');
  }
}
