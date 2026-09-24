/** Saved-search drawer interactions on the Search page. */
import { Locator, Page } from '@playwright/test';

export class SavedSearchesListPage {
  readonly page: Page;
  readonly pageContainer: Locator;
  readonly searchInput: Locator;
  readonly newSearchButton: Locator;

  private readonly confirmConfirmButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageContainer = page.getByTestId('saved-searches-drawer');
    this.searchInput = page.getByPlaceholder('Search saved searches');
    this.newSearchButton = page.getByTestId('new-search-button');
    this.confirmConfirmButton = page.getByTestId('confirm-confirm-button');
  }

  async goto() {
    await this.page.goto('/search?panel=saved-searches', {
      waitUntil: 'networkidle',
    });
  }

  async searchSavedSearches(query: string) {
    await this.searchInput.fill(query);
  }

  async clearSearch() {
    await this.searchInput.clear();
  }

  async clickNewSearch() {
    await this.newSearchButton.click();
    await this.page.waitForURL(url => !url.searchParams.has('panel'));
  }

  getSavedSearchCard(name: string) {
    return this.getSavedSearchRow(name);
  }

  getSavedSearchRow(name: string) {
    return this.pageContainer
      .getByTestId('saved-search-row')
      .filter({ hasText: name });
  }

  async deleteSavedSearchFromCard(name: string) {
    await this.deleteSavedSearchFromRow(name);
  }

  async deleteSavedSearchFromRow(name: string) {
    const row = this.getSavedSearchRow(name);
    await row.getByRole('button', { name: `Actions for ${name}` }).click();
    await this.page.getByTestId('saved-search-delete').click();
    await this.confirmConfirmButton.click();
  }

  async renameSavedSearchFromRow(name: string, nextName: string) {
    const row = this.getSavedSearchRow(name);
    await row.getByRole('button', { name: `Actions for ${name}` }).click();
    await this.page.getByTestId('saved-search-rename').click();
    const input = this.page.getByTestId('saved-search-rename-input');
    await input.fill(nextName);
    await input.press('Enter');
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
    return this.pageContainer.getByText('No saved searches yet');
  }

  getNoMatchesState() {
    return this.pageContainer.getByText('No matching saved searches yet');
  }

  getFavoritesSection() {
    return this.pageContainer.getByRole('tab', { name: 'Favorites' });
  }

  async showFavorites() {
    await this.getFavoritesSection().click();
  }

  async showAll() {
    await this.pageContainer.getByRole('tab', { name: 'All' }).click();
  }

  async toggleFavoriteOnCard(name: string) {
    const card = this.getSavedSearchCard(name);
    await card.getByTestId('favorite-button').click();
  }

  async toggleFavoriteOnRow(name: string) {
    await this.toggleFavoriteOnCard(name);
  }

  getFavoritedSearchCard(name: string) {
    return this.getSavedSearchRow(name);
  }

  async toggleFavoriteOnFavoritedCard(name: string) {
    await this.toggleFavoriteOnCard(name);
  }
}
