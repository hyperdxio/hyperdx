/**
 * SearchPage - Page object for the /search page
 * Encapsulates all interactions with the search interface
 */
import { expect, Locator, Page } from '@playwright/test';

import { FilterComponent } from '../components/FilterComponent';
import { InfrastructurePanelComponent } from '../components/InfrastructurePanelComponent';
import { PatternSidePanelComponent } from '../components/PatternSidePanelComponent';
import { SavedSearchModalComponent } from '../components/SavedSearchModalComponent';
import { SearchPageAlertModalComponent } from '../components/SearchPageAlertModalComponent';
import { SidePanelComponent } from '../components/SidePanelComponent';
import { TableComponent } from '../components/TableComponent';
import { TimePickerComponent } from '../components/TimePickerComponent';
import { WhereInputComponent } from '../components/WhereInputComponent';
import { DEFAULT_TRACES_SOURCE_NAME } from '../utils/constants';
import { borderedBox, dismissSqlAutocomplete } from '../utils/locators';
import type { MultilineField } from '../utils/multiline-input';

type SaveSearchModalProps = {
  update: boolean;
};
export class SearchPage {
  readonly page: Page;
  readonly table: TableComponent;
  readonly timePicker: TimePickerComponent;
  readonly sidePanel: SidePanelComponent;
  readonly patternSidePanel: PatternSidePanelComponent;
  readonly infrastructure: InfrastructurePanelComponent;
  readonly filters: FilterComponent;
  readonly whereInput: WhereInputComponent;
  readonly savedSearchModal: SavedSearchModalComponent;
  readonly savedSearchNameTitle: Locator;
  readonly savedSearchStatus: Locator;
  readonly alertModal: SearchPageAlertModalComponent;
  readonly defaultTimeout: number = 3000;
  private readonly alertsButtonLocator: Locator;

  // Page-specific locators
  private readonly searchForm: Locator;
  private readonly searchInput: Locator;
  private readonly searchButton: Locator;
  private readonly saveSearchButton: Locator;
  private readonly updateSearchButton: Locator;
  private readonly sourceSelector: Locator;

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
    this.patternSidePanel = new PatternSidePanelComponent(page);
    this.infrastructure = new InfrastructurePanelComponent(page);
    this.filters = new FilterComponent(page);
    this.savedSearchModal = new SavedSearchModalComponent(page);
    this.alertModal = new SearchPageAlertModalComponent(page);
    this.alertsButtonLocator = page.getByTestId('alerts-button');
    this.savedSearchNameTitle = page.locator(
      '[data-testid="saved-search-name"]',
    );
    this.savedSearchStatus = page.getByTestId('saved-search-status');

    // Define page-specific locators
    this.searchForm = page.getByTestId('search-form');
    this.whereInput = new WhereInputComponent(page, this.searchForm);
    this.searchInput = page.getByTestId('search-input');
    this.searchButton = page.getByTestId('search-submit-button');
    this.saveSearchButton = page.getByTestId('save-search-button');
    this.updateSearchButton = page.getByTestId('update-search-button');
    this.sourceSelector = page.getByTestId('source-selector');
  }

  get sourceActionsMenu() {
    return this.page.getByTestId('source-actions-menu');
  }

  get createNewSourceItem() {
    return this.page.getByRole('menuitem', { name: 'Create new source' });
  }

  get editSourceItem() {
    return this.page.getByRole('menuitem', { name: 'Edit source' });
  }

  get manageSourcesItem() {
    return this.page.getByRole('menuitem', { name: 'Manage sources' });
  }

  get viewSchemaItem() {
    return this.page.getByRole('menuitem', { name: 'View schema' });
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

  /** The "Event Patterns" analysis-mode tab in the filters sidebar. */
  get eventPatternsTab() {
    return this.page.getByRole('tab', { name: 'Event Patterns' });
  }

  /**
   * The pattern list table (the "Event Patterns" grid). It renders before the
   * flyout in the DOM (the flyout is a portaled drawer), so `.first()` resolves
   * the pattern list even after the flyout's sample table mounts.
   */
  get patternListTable() {
    return this.page.getByTestId('search-results-table').first();
  }

  get patternListRows() {
    return this.patternListTable.locator('[data-testid^="table-row-"]');
  }

  /**
   * Switch to Event Patterns mode and wait for the (client-side, Drain-based)
   * pattern list to finish clustering and render at least one pattern row.
   */
  async switchToEventPatterns(timeout = 60_000) {
    await this.eventPatternsTab.click();
    await this.patternListRows.first().waitFor({ state: 'visible', timeout });
  }

  /**
   * The Level-column cell of a pattern-list row. The list renders its columns
   * as sibling divs inside the row's content button (see PatternTable's
   * displayedColumns: Trend, Count, Level, Pattern).
   */
  patternListLevelCell(rowIndex = 0) {
    const PATTERN_LIST_LEVEL_COLUMN_INDEX = 2;
    return this.patternListRows
      .nth(rowIndex)
      .locator('td > button > div')
      .nth(PATTERN_LIST_LEVEL_COLUMN_INDEX);
  }

  /** Open the first pattern's sample flyout and wait for it to render. */
  async openFirstPattern(timeout = 30_000) {
    await this.patternListRows.first().click();
    await this.patternSidePanel.container.waitFor({
      state: 'visible',
      timeout,
    });
    await this.patternSidePanel.firstRow.waitFor({ state: 'visible', timeout });
  }

  async openEditSourceModal() {
    await this.sourceActionsMenu.click();
    await this.editSourceItem.click();
  }

  async sourceModalShowOptionalFields() {
    const optionalFieldsButton = this.page.getByText(
      'Configure Optional Fields',
    );
    if (await optionalFieldsButton.isVisible()) {
      await optionalFieldsButton.click();
    }
  }

  async saveSourceForm() {
    await this.page.getByRole('button', { name: 'Save Source' }).click();
  }

  /**
   * Perform a search with the given query
   */
  async performSearch(query: string) {
    await this.searchInput.fill(query);
    await this.page.keyboard.press('Escape');
    await this.searchButton.click();
    await this.page.waitForLoadState('networkidle');
    // Wait for new results to populate
    await this.table.waitForRowsToPopulate();
  }

  /**
   * Open a log row that carries trace context (a non-empty TraceId) so the side
   * panel renders the cross-source "View Trace" action.
   */
  async openTraceLinkedLogRow(traceId: string = 'trace-0') {
    await this.timePicker.selectRelativeTime('Last 1 days');
    await this.performSearch(`TraceId:"${traceId}"`);
    await expect(this.table.firstRow).toBeVisible();
    await this.table.clickFirstRow();
    await expect(this.sidePanel.tabs).toBeVisible();
  }

  /** The selection menu button in the table header, once rows are selected. */
  get selectionCount() {
    return this.page.getByTestId('row-selection-count');
  }

  /** Only rendered while live tail is stopped. */
  get resumeLiveTailButton() {
    return this.page.getByRole('button', { name: 'Resume Live Tail' });
  }

  async resumeLiveTail() {
    await this.resumeLiveTailButton.click();
  }

  /** Opens the selection menu and picks one of its actions. */
  private async clickSelectionMenuItem(testId: string) {
    await this.selectionCount.click();
    await this.page.getByTestId(testId).click();
  }

  async copySelectedRows(format: 'csv' | 'json' = 'csv') {
    await this.clickSelectionMenuItem(`row-selection-copy-${format}`);
  }

  /** The toast confirming a clipboard copy of the selected rows. */
  getCopiedSelectionToast() {
    return this.page.getByText(/copied \d+ rows? as (CSV|JSON)/i);
  }

  async clearRowSelection() {
    await this.clickSelectionMenuItem('row-selection-clear');
  }

  /**
   * Download the selected rows and return the CSV text. The export triggers a
   * client-side anchor download, so capture the Playwright download event and
   * read its stream.
   */
  async downloadSelectedRowsCsv(): Promise<{
    filename: string;
    content: string;
  }> {
    const downloadPromise = this.page.waitForEvent('download');
    await this.clickSelectionMenuItem('row-selection-download-csv');
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      filename: download.suggestedFilename(),
      content: Buffer.concat(chunks).toString('utf-8'),
    };
  }

  /**
   * Open the waterfall's spans filter — a `SearchWhereInput` with
   * `allowMultiline={false}` in both SQL and Lucene.
   */
  async openTraceSpansFilter(): Promise<WhereInputComponent> {
    await this.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await this.timePicker.selectRelativeTime('Last 1 days');
    await this.submitEmptySearch();
    await expect(this.table.firstRow).toBeVisible();
    await this.table.clickFirstRow();
    await expect(this.sidePanel.container).toBeVisible();
    await expect(this.sidePanel.getTab('trace')).toBeVisible({
      timeout: 15_000,
    });
    await this.sidePanel.clickTab('trace');
    await this.sidePanel.toggleTraceFilters();
    const whereInput = this.sidePanel.traceSpansWhereInput;
    await expect(whereInput.languageSwitch).toBeVisible();
    return whereInput;
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
    await this.whereInput.selectLanguage('SQL');
  }

  /**
   * Switch to Lucene mode
   */
  async switchToLuceneMode() {
    await this.whereInput.selectLanguage('Lucene');
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
   * Click "Save as New Search" from the action bar menu on an existing saved search.
   * Opens the save search modal in "create" mode for duplicating the current search.
   */
  async clickSaveAsNew() {
    // Click the action bar menu trigger (three dots icon next to the saved search name)
    await this.page.getByTestId('search-page-action-bar').click();
    await this.page
      .getByRole('menuitem', { name: 'Save as New Search' })
      .click();
  }

  /**
   * Open the alerts creation modal for the current saved search
   */
  async openAlertsModal() {
    await this.alertsButtonLocator.click();
  }

  get alertsButton() {
    return this.alertsButtonLocator;
  }

  /**
   * Get search results table
   */
  getSearchResultsTable() {
    return this.page.locator('[data-testid="search-results-table"]');
  }

  /**
   * Locator for the results table's error state (rendered by ChartErrorState
   * when the underlying ClickHouse query fails). Assert `toHaveCount(0)` to
   * confirm the results loaded without error.
   */
  getTableError() {
    return this.page.getByText(/Error loading/i);
  }

  /** Move focus into the WHERE input, whichever language it is rendering. */
  async focusWhereInput() {
    await this.whereInput.focus();
  }

  /**
   * Border colors of the two halves of the WHERE control. They sit flush
   * against each other, so a focus state on only one reads as half-focused.
   */
  async getWhereBorderColors(): Promise<{
    languageSwitch: string;
    input: string;
  }> {
    return this.whereInput.borderColors();
  }

  /**
   * Get SELECT editor (CodeMirror)
   */
  getSELECTEditor() {
    return this.page.locator('.cm-content').first();
  }

  async getSelectBorderColor(): Promise<string> {
    return this.selectClauseField().visibleBox.evaluate(
      el => getComputedStyle(el).borderTopColor,
    );
  }

  async getOrderByBorderColor(): Promise<string> {
    return this.orderByClauseField().visibleBox.evaluate(
      el => getComputedStyle(el).borderTopColor,
    );
  }

  /** The SELECT / ORDER BY clause editors as growth-assertable fields. */
  selectClauseField(): MultilineField {
    return this.clauseField(this.getSELECTEditor());
  }

  orderByClauseField(): MultilineField {
    return this.clauseField(this.getOrderByEditor());
  }

  /** Empty a clause editor so it starts from one short line. */
  async clearClause(field: MultilineField) {
    await field.focusTarget.press('ControlOrMeta+A');
    await field.focusTarget.press('Backspace');
  }

  private clauseField(content: Locator): MultilineField {
    return {
      focusTarget: content,
      growthBox: content,
      visibleBox: borderedBox(content),
    };
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
    // Insert atomically rather than per-keystroke: under load CodeMirror can
    // drop individual keys from keyboard.type (e.g. "Timestamp" -> "Timstamp"),
    // which then gets faithfully saved and fails later assertions.
    await this.page.keyboard.insertText(selectStatement);
    // Dismiss the autocomplete popup so it can't linger and overlay the next
    // control (e.g. the Save Search button).
    await dismissSqlAutocomplete(this.page);
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

  /**
   * Returns a locator for the yellow Mantine notification shown when one or
   * more sidebar filters are dropped because they don't exist on the newly
   * selected source's schema.
   *
   * The message format from DBSearchPage.tsx:
   *   "N filter(s) didn't apply to this source and was/were removed."
   */
  getDroppedFiltersToast() {
    return this.page.getByText(/filter.* didn't apply to this source/i);
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
    return this.page.getByRole('option', { name: 'Lucene', exact: true });
  }

  get sqlModeTab() {
    return this.page.getByRole('option', { name: 'SQL', exact: true });
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

  get totalCountText() {
    return this.page.getByTestId('search-total-count');
  }

  async waitForTotalCountLoaded(timeout = 15_000) {
    await expect(this.totalCountText).toBeVisible({ timeout });
    await expect(this.totalCountText).not.toContainText('···', { timeout });
  }
}
