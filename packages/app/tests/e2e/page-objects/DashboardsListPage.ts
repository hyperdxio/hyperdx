/**
 * DashboardsListPage - Page object for the dashboards listing page
 * Encapsulates interactions with dashboard browsing, search, filtering, and management
 */
import { expect, Locator, Page } from '@playwright/test';

export class DashboardsListPage {
  readonly page: Page;
  readonly pageContainer: Locator;
  readonly searchInput: Locator;
  readonly newDashboardButton: Locator;
  readonly createDashboardButton: Locator;
  readonly importDashboardButton: Locator;
  readonly tempDashboardButton: Locator;
  readonly gridViewButton: Locator;
  readonly listViewButton: Locator;
  readonly browseTemplatesLink: Locator;

  private readonly emptyCreateDashboardButton: Locator;
  private readonly emptyImportDashboardButton: Locator;
  private readonly confirmConfirmButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.pageContainer = page.getByTestId('dashboards-list-page');
    this.searchInput = page.getByPlaceholder('Search by name');
    this.newDashboardButton = page.getByTestId('new-dashboard-button');
    this.createDashboardButton = page.getByTestId('create-dashboard-button');
    this.importDashboardButton = page.getByTestId('import-dashboard-button');
    this.tempDashboardButton = page.getByTestId('temp-dashboard-button');
    this.gridViewButton = page.getByRole('button', { name: 'Grid view' });
    this.listViewButton = page.getByRole('button', { name: 'List view' });
    this.browseTemplatesLink = page.getByRole('link', {
      name: /Browse dashboard templates/,
    });
    this.emptyCreateDashboardButton = page.getByTestId(
      'empty-create-dashboard-button',
    );
    this.emptyImportDashboardButton = page.getByTestId(
      'empty-import-dashboard-button',
    );
    this.confirmConfirmButton = page.getByTestId('confirm-confirm-button');
  }

  async goto() {
    await this.page.goto('/dashboards/list', { waitUntil: 'networkidle' });
  }

  async clickBrowseTemplates() {
    await this.browseTemplatesLink.click();
    await this.page.waitForURL('**/dashboards/templates');
  }

  async searchDashboards(query: string) {
    await this.searchInput.fill(query);
  }

  async clearSearch() {
    await this.searchInput.clear();
  }

  async createNewDashboard() {
    await this.newDashboardButton.click();
    await this.createDashboardButton.click();
    await this.page.waitForURL('**/dashboards/**');
  }

  async goToTempDashboard() {
    await this.newDashboardButton.click();
    await this.tempDashboardButton.click();
  }

  async switchToGridView() {
    await this.gridViewButton.click();
  }

  async switchToListView() {
    await this.listViewButton.click();
  }

  getDashboardCard(name: string) {
    return this.pageContainer.locator('a').filter({ hasText: name });
  }

  getDashboardRow(name: string) {
    return this.pageContainer.locator('tr').filter({ hasText: name });
  }

  async clickDashboard(name: string) {
    await this.getDashboardCard(name).click();
    await this.page.waitForURL('**/dashboards/**');
  }

  async deleteDashboardFromCard(name: string) {
    const card = this.getDashboardCard(name);
    // Click the menu button (three dots) within the card
    await card.getByRole('button').click();
    await this.page.getByRole('menuitem', { name: 'Delete' }).click();
    // Confirm deletion
    await this.confirmConfirmButton.click();
  }

  async deleteDashboardFromRow(name: string) {
    const row = this.getDashboardRow(name);
    // Click the menu button within the row
    await row.getByRole('button').click();
    await this.page.getByRole('menuitem', { name: 'Delete' }).click();
    // Confirm deletion
    await this.confirmConfirmButton.click();
  }

  getPresetDashboardCard(name: string) {
    return this.pageContainer.locator('a').filter({ hasText: name });
  }

  getTagFilterSelect() {
    return this.page.getByPlaceholder('Filter by tag');
  }

  async selectTagFilter(tag: string) {
    await this.getTagFilterSelect().click();
    await this.page.getByRole('option', { name: tag, exact: true }).click();
  }

  async clearTagFilter() {
    // The Mantine Select clear button is a sibling button next to the textbox
    const select = this.getTagFilterSelect();
    await select.locator('..').locator('button').click();
  }

  getEmptyState() {
    return this.pageContainer.getByText('No dashboards yet.');
  }

  getNoMatchesState() {
    return this.pageContainer.getByText('No matching dashboards yet.');
  }
}
