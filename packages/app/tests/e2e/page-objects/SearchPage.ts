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

export class SearchPage {
  readonly page: Page;
  readonly table: TableComponent;
  readonly timePicker: TimePickerComponent;
  readonly sidePanel: SidePanelComponent;
  readonly infrastructure: InfrastructurePanelComponent;
  readonly filters: FilterComponent;
  readonly savedSearchModal: SavedSearchModalComponent;

  // Page-specific locators
  private readonly searchForm: Locator;
  private readonly searchInput: Locator;
  private readonly searchButton: Locator;
  private readonly saveSearchButton: Locator;
  private readonly luceneTab: Locator;
  private readonly sqlTab: Locator;

  constructor(page: Page) {
    this.page = page;

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
    this.searchForm = page.locator('[data-testid="search-form"]');
    this.searchInput = page.locator('[data-testid="search-input"]');
    this.searchButton = page.locator('[data-testid="search-submit-button"]');
    this.saveSearchButton = page.locator('[data-testid="save-search-button"]');
    this.luceneTab = page.getByRole('button', { name: 'Lucene', exact: true });
    this.sqlTab = page.getByRole('button', { name: 'SQL', exact: true });
  }

  /**
   * Navigate to the search page
   */
  async goto() {
    await this.page.goto('/search');
    // Wait for page to load
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Perform a search with the given query
   */
  async performSearch(query: string) {
    await this.searchInput.fill(query);
    await this.searchButton.click();
    // Wait for search results to load
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Perform search and wait for API response
   */
  async performSearchAndWaitForResults(query: string) {
    const responsePromise = this.page.waitForResponse(
      resp => resp.url().includes('/clickhouse-proxy') && resp.status() === 200,
    );

    await this.performSearch(query);
    await responsePromise;
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
    await this.searchInput.fill(query);
    await this.searchButton.click();
    // Wait for search results to load
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Submit search without query (empty search)
   */
  async submitEmptySearch() {
    await this.searchButton.click();
    // Wait for search results to load
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Open save search modal
   */
  async openSaveSearchModal() {
    await this.saveSearchButton.scrollIntoViewIfNeeded();
    await this.saveSearchButton.click();
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
   * Set custom SELECT columns
   */
  async setCustomSELECT(selectStatement: string) {
    const selectEditor = this.getSELECTEditor();
    await selectEditor.click({ clickCount: 3 }); // Select all
    await this.page.keyboard.type(selectStatement);
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
}
