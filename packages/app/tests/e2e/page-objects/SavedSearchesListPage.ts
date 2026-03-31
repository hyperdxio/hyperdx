/**
 * SavedSearchesListPage - Page object for the saved searches listing page
 * Encapsulates interactions with saved search browsing, search, filtering, and management
 */
import { Locator, Page } from '@playwright/test';

export class SavedSearchesListPage {
  readonly page: Page;
  readonly pageContainer: Locator;
  readonly searchInput: Locator;
  readonly newSearchButton: Locator;
  readonly gridViewButton: Locator;
  readonly listViewButton: Locator;

  private readonly emptyNewSearchButton: Locator;
  private readonly confirmConfirmButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageContainer = page.getByTestId('saved-searches-list-page');
    this.searchInput = page.getByPlaceholder('Search by name');
    this.newSearchButton = page.getByTestId('new-search-button');
    this.gridViewButton = page.getByRole('button', { name: 'Grid view' });
    this.listViewButton = page.getByRole('button', { name: 'List view' });
    this.emptyNewSearchButton = page.getByTestId('empty-new-search-button');
    this.confirmConfirmButton = page.getByTestId('confirm-confirm-button');
  }

  async goto() {
    await this.page.goto('/search/list', { waitUntil: 'networkidle' });
  }

  async searchSavedSearches(query: string) {
    await this.searchInput.fill(query);
  }

  async clearSearch() {
    await this.searchInput.clear();
  }

  async clickNewSearch() {
    await this.newSearchButton.click();
    await this.page.waitForURL(/\/search\?/);
  }

  async switchToGridView() {
    await this.gridViewButton.click();
  }

  async switchToListView() {
    await this.listViewButton.click();
  }

  getSavedSearchCard(name: string) {
    return this.pageContainer.locator('a').filter({ hasText: name });
  }

  getSavedSearchRow(name: string) {
    return this.pageContainer.locator('tr').filter({ hasText: name });
  }

  async deleteSavedSearchFromCard(name: string) {
    const card = this.getSavedSearchCard(name);
    await card.getByRole('button').click();
    await this.page.getByRole('menuitem', { name: 'Delete' }).click();
    await this.confirmConfirmButton.click();
  }

  async deleteSavedSearchFromRow(name: string) {
    const row = this.getSavedSearchRow(name);
    await row.getByRole('button').click();
    await this.page.getByRole('menuitem', { name: 'Delete' }).click();
    await this.confirmConfirmButton.click();
  }

  getTagFilterSelect() {
    return this.page.getByPlaceholder('Filter by tag');
  }

  async selectTagFilter(tag: string) {
    await this.getTagFilterSelect().click();
    await this.page.getByRole('option', { name: tag, exact: true }).click();
  }

  async clearTagFilter() {
    const select = this.getTagFilterSelect();
    await select.locator('..').locator('button').click();
  }

  getEmptyState() {
    return this.pageContainer.getByText('No saved searches yet.');
  }

  getNoMatchesState() {
    return this.pageContainer.getByText('No matching saved searches.');
  }
}
