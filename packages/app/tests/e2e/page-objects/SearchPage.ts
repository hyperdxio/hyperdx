/**
 * SearchPage - Page object for the /search page
 * Encapsulates all interactions with the search interface
 */
import { Locator, Page } from '@playwright/test';

import { FilterComponent } from '../components/FilterComponent';
import { InfrastructurePanelComponent } from '../components/InfrastructurePanelComponent';
import { SavedSearchModalComponent } from '../components/SavedSearchModalComponent';
import { SidePanelComponent } from '../components/SidePanelComponent';
import { TableComponent } from '../components/TableComponent';
import { TimePickerComponent } from '../components/TimePickerComponent';

type SaveSearchModalProps = {
  update: boolean;
};
export class SearchPage {
  readonly page: Page;
  readonly table: TableComponent;
  readonly timePicker: TimePickerComponent;
  readonly sidePanel: SidePanelComponent;
  readonly infrastructure: InfrastructurePanelComponent;
  readonly filters: FilterComponent;
  readonly savedSearchModal: SavedSearchModalComponent;
  readonly defaultTimeout: number = 3000;
  readonly editSourceMenuItem: Locator;

  // Page-specific locators
  private readonly searchForm: Locator;
  private readonly searchInput: Locator;
  private readonly searchButton: Locator;
  private readonly saveSearchButton: Locator;
  private readonly updateSearchButton: Locator;
  private readonly luceneTab: Locator;
  private readonly sqlTab: Locator;
  private readonly sourceSelector: Locator;
  private readonly sourceSettingsMenu: Locator;
  private readonly createNewSourceMenuItem: Locator;

  constructor(page: Page, defaultTimeout: number = 3000) {
    this.page = page;
    this.defaultTimeout = defaultTimeout;
    // Initialize reusable components
    this.table = new TableComponent(
      page,
      '[data-testid="search-results-table"]',
    );
    this.timePicker = new TimePickerComponent(page);
    this.sidePanel = new SidePanelComponent(page, 'row-side-panel');
    this.infrastructure = new InfrastructurePanelComponent(page);
    this.filters = new FilterComponent(page);
    this.savedSearchModal = new SavedSearchModalComponent(page);

    // Define page-specific locators
    this.searchForm = page.getByTestId('search-form');
    this.searchInput = page.getByTestId('search-input');
    this.searchButton = page.getByTestId('search-submit-button');
    this.saveSearchButton = page.getByTestId('save-search-button');
    this.updateSearchButton = page.getByTestId('update-search-button');
    this.luceneTab = page.getByRole('button', { name: 'Lucene', exact: true });
    this.sqlTab = page.getByRole('button', { name: 'SQL', exact: true });
    this.sourceSelector = page.getByTestId('source-selector');
    this.sourceSettingsMenu = page.getByTestId('source-settings-menu');
    this.editSourceMenuItem = page.getByTestId('edit-sources-menu-item');
    this.createNewSourceMenuItem = page.getByTestId(
      'create-new-source-menu-item',
    );
  }

  get sourceMenu() {
    return this.sourceSettingsMenu;
  }

  get createNewSourceItem() {
    return this.createNewSourceMenuItem;
  }

  /**
   * Navigate to the search page
   */
  async goto() {
    await this.page.goto('/search');
    // Wait for page to load
    await this.table.waitForRowsToPopulate();
  }

  async selectSource(sourceName: string) {
    await this.sourceSelector.click();
    await this.page
      .getByRole('option', { name: sourceName, exact: true })
      .click();
  }

  async openEditSourceModal() {
    await this.sourceSettingsMenu.click();
    await this.editSourceMenuItem.click();
  }

  async sourceModalShowOptionalFields() {
    const optionalFieldsButton = this.page.getByText(
      'Configure Optional Fields',
    );
    if (await optionalFieldsButton.isVisible()) {
      await optionalFieldsButton.click();
    }
  }

  /**
   * Perform a search with the given query
   */
  async performSearch(query: string) {
    await this.searchInput.fill(query);
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
    // Wait for new results to populate
    await this.table.waitForRowsToPopulate();
  }

  /**
   * Clear the search input
   */
  async clearSearch() {
    await this.searchInput.fill('');
  }

  /**
   * Switch to SQL mode
   */
  async switchToSQLMode() {
    await this.sqlTab.click();
  }

  /**
   * Switch to Lucene mode
   */
  async switchToLuceneMode() {
    await this.luceneTab.click();
  }

  /**
   * Execute SQL query (when in SQL mode)
   */
  async executeSQLQuery(query: string) {
    await this.switchToSQLMode();
    await this.performSearch(query);
  }

  /**
   * Submit search without query (empty search)
   */
  async submitEmptySearch() {
    // Store reference to current first row (if exists) to detect when results refresh
    const hadExistingRows = (await this.table.getRows().count()) > 0;
    const oldFirstRowTestId = hadExistingRows
      ? await this.table.firstRow.getAttribute('data-testid')
      : null;

    await this.searchButton.click();

    if (oldFirstRowTestId) {
      // Wait for old first row to disappear (indicates results are refreshing)
      await this.page
        .locator(`[data-testid="${oldFirstRowTestId}"]`)
        .waitFor({ state: 'hidden', timeout: this.defaultTimeout })
        .catch(() => {
          // Old row might already be gone, that's fine
        });
    }

    // Wait for new results to populate
    await this.table.waitForRowsToPopulate();
  }

  /**
   * Open save search modal
   */
  async openSaveSearchModal(options: SaveSearchModalProps = { update: false }) {
    const button = options.update
      ? this.updateSearchButton
      : this.saveSearchButton;
    await button.scrollIntoViewIfNeeded();
    await button.click();
  }

  /**
   * Get search results table
   */
  getSearchResultsTable() {
    return this.page.locator('[data-testid="search-results-table"]');
  }

  /**
   * Get SELECT editor (CodeMirror)
   */
  getSELECTEditor() {
    return this.page.locator('.cm-content').first();
  }

  /**
   * Get ORDER BY editor (CodeMirror)
   */
  getOrderByEditor() {
    return this.page.locator('.cm-content').nth(1);
  }

  /**
   * Set custom SELECT columns
   */
  async setCustomSELECT(selectStatement: string) {
    const selectEditor = this.getSELECTEditor();
    await selectEditor.click({ clickCount: 3 }); // Select all
    await this.page.keyboard.type(selectStatement);
  }

  /**
   * Set custom ORDER BY clause
   */
  async setCustomOrderBy(orderByStatement: string) {
    const orderByEditor = this.getOrderByEditor();
    await orderByEditor.click({ clickCount: 3 }); // Select all
    await this.page.keyboard.type(orderByStatement);
    // CLoses Autocomplete Modal if open
    await this.page.keyboard.press('Escape');
  }

  /**
   * Get histogram chart
   */
  getHistogram() {
    return this.page.locator('.recharts-responsive-container').first();
  }

  /**
   * Get histogram surface for dragging
   */
  getHistogramSurface() {
    return this.page.locator('.recharts-surface').first();
  }

  /**
   * Drag on histogram to zoom into time range
   * @param startPercent - Start position as percentage (0-1)
   * @param endPercent - End position as percentage (0-1)
   */
  async dragHistogramToZoom(
    startPercent: number = 0.25,
    endPercent: number = 0.75,
  ) {
    const chartSurface = this.getHistogramSurface();
    const box = await chartSurface.boundingBox();

    if (!box) {
      throw new Error('Chart surface not found');
    }

    const startX = box.x + box.width * startPercent;
    const endX = box.x + box.width * endPercent;
    const y = box.y + box.height / 2;

    await this.page.mouse.move(startX, y);
    await this.page.mouse.down();
    await this.page.mouse.move(endX, y, { steps: 10 });
    await this.page.mouse.up();
  }

  // Getters for assertions in spec files

  get form() {
    return this.searchForm;
  }

  get input() {
    return this.searchInput;
  }

  get submitButton() {
    return this.searchButton;
  }

  get luceneModeTab() {
    return this.luceneTab;
  }

  get sqlModeTab() {
    return this.sqlTab;
  }

  get sourceDropdown() {
    return this.sourceSelector;
  }

  get sourceOptions() {
    return this.page.getByRole('option');
  }

  get currentSource() {
    return this.page.locator('[data-testid="source-selector"]');
  }

  get otherSources() {
    return this.page.getByRole('option', { selected: false });
  }
}
