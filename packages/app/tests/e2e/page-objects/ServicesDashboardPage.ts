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
    await this.page.getByRole('option', { name: sourceName }).click();
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Switch to Lucene mode, type a query into the search input, and run the query.
   */
  async searchLucene(query: string) {
    const languageSelect = this.page
      .getByTestId('where-language-switch')
      .getByRole('textbox', { name: 'Query language' });
    await languageSelect.click();
    await this.page
      .getByRole('option', { name: 'Lucene', exact: true })
      .click();
    await this.page.getByTestId('services-search-input').fill(query);
    await this.page.getByRole('button', { name: 'Run' }).click();
    await this.page.waitForLoadState('networkidle');
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
