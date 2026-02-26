/**
 * DashboardPage - Page object for dashboard pages
 * Encapsulates interactions with dashboard creation, editing, and tile management
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { expect, Locator, Page } from '@playwright/test';

import { ChartEditorComponent } from '../components/ChartEditorComponent';
import { TimePickerComponent } from '../components/TimePickerComponent';
import { getSqlEditor } from '../utils/locators';

/**
 * Config format tile config, as accepted by the external dashboard API.
 * Used with verifyTileFormFromConfig
 */
export type TileConfig = {
  displayType: Exclude<DisplayType, 'heatmap'>;
  sourceId?: string;
  select?:
    | {
        aggFn?: string;
        where?: string;
        whereLanguage?: 'sql' | 'lucene';
        alias?: string;
        valueExpression?: string;
      }[]
    | string;
  where?: string;
  whereLanguage?: 'sql' | 'lucene';
  groupBy?: string;
  markdown?: string;
};
type SeriesType = 'time' | 'number' | 'table' | 'search' | 'markdown' | 'pie';
/**
 * Series data structure for chart verification
 * Supports all chart types: time, number, table, search, markdown
 */
export type SeriesData = {
  type: SeriesType;
  sourceId?: string;
  aggFn?: string;
  field?: string;
  where?: string;
  whereLanguage?: 'sql' | 'lucene';
  groupBy?: string[];
  alias?: string;
  displayType?: 'line' | 'stacked_bar';
  sortOrder?: 'desc' | 'asc';
  fields?: string[]; // For search type
  content?: string; // For markdown type
  numberFormat?: Record<string, unknown>;
  metricDataType?: string;
  metricName?: string;
  level?: number;
};

export class DashboardPage {
  readonly page: Page;
  readonly timePicker: TimePickerComponent;
  readonly chartEditor: ChartEditorComponent;
  readonly granularityPicker: Locator;
  readonly searchInput: Locator;

  private readonly createDashboardButton: Locator;
  private readonly addTileButton: Locator;
  private readonly dashboardNameHeading: Locator;
  private readonly searchSubmitButton: Locator;
  private readonly liveButton: Locator;
  private readonly tempDashboardBanner: Locator;
  private readonly editFiltersButton: Locator;
  private readonly filtersListModal: Locator;
  private readonly emptyFiltersListModal: Locator;
  private readonly addFiltersButton: Locator;
  private readonly closeFiltersModalButton: Locator;
  private readonly filtersSourceSelector: Locator;
  private readonly saveButton: Locator;
  private readonly tileSourceSelector: Locator;
  private readonly aliasInput: Locator;
  private readonly aggFnSelect: Locator;
  private readonly markdownTextarea: Locator;
  private readonly confirmModal: Locator;
  private readonly confirmCancelButton: Locator;
  private readonly confirmConfirmButton: Locator;
  private readonly dashboardMenuButton: Locator;
  private readonly saveDefaultQueryAndFiltersMenuItem: Locator;
  private readonly removeDefaultQueryAndFiltersMenuItem: Locator;

  constructor(page: Page) {
    this.page = page;
    this.timePicker = new TimePickerComponent(page);
    this.chartEditor = new ChartEditorComponent(page);

    this.createDashboardButton = page.locator(
      '[data-testid="create-dashboard-button"]',
    );
    this.addTileButton = page.locator('[data-testid="add-new-tile-button"]');
    this.searchInput = page.locator('[data-testid="search-input"]');
    this.searchSubmitButton = page.locator(
      '[data-testid="search-submit-button"]',
    );
    this.liveButton = page.locator('button:has-text("Live")');
    this.dashboardNameHeading = page.getByRole('heading', { level: 3 });
    this.granularityPicker = page.getByTestId('granularity-picker');
    this.tempDashboardBanner = page.locator(
      '[data-testid="temporary-dashboard-banner"]',
    );
    this.editFiltersButton = page.getByTestId('edit-filters-button');
    this.filtersListModal = page.getByTestId('dashboard-filters-list');
    this.emptyFiltersListModal = page.getByTestId(
      'dashboard-filters-empty-state',
    );
    this.addFiltersButton = page.getByTestId('add-filter-button');
    this.closeFiltersModalButton = page.getByTestId('close-filters-button');
    this.filtersSourceSelector = page.getByTestId('source-selector');
    this.saveButton = page.getByTestId('chart-save-button');

    // Tile editor selectors
    this.tileSourceSelector = page.getByTestId('source-selector');
    this.aliasInput = page.getByTestId('series-alias-input');
    this.aggFnSelect = page.getByTestId('agg-fn-select');
    this.markdownTextarea = page.locator('textarea[name="markdown"]');
    this.confirmModal = page.getByTestId('confirm-modal');
    this.confirmCancelButton = page.getByTestId('confirm-cancel-button');
    this.confirmConfirmButton = page.getByTestId('confirm-confirm-button');
    this.dashboardMenuButton = page.getByTestId('dashboard-menu-button');
    this.saveDefaultQueryAndFiltersMenuItem = page.getByTestId(
      'save-default-query-filters-menu-item',
    );
    this.removeDefaultQueryAndFiltersMenuItem = page.getByTestId(
      'remove-default-query-filters-menu-item',
    );
  }

  /**
   * Navigate to dashboards list
   */
  async goto() {
    await this.page.goto('/dashboards', { waitUntil: 'networkidle' });
  }

  /**
   * Navigate to specific dashboard by ID
   */
  async gotoDashboard(dashboardId: string) {
    await this.page.goto(`/dashboards/${dashboardId}`);
  }

  /**
   * Create a new dashboard
   */
  async createNewDashboard() {
    await this.createDashboardButton.click();
    await this.page.waitForURL('**/dashboards**');
  }

  async changeGranularity(granularity: string) {
    await this.granularityPicker.click();

    // Wait for dropdown options to appear and click the desired option
    await this.page
      .locator('[role="option"]', { hasText: granularity })
      .click();
  }

  /**
   * Edit dashboard name
   */
  async editDashboardName(newName: string) {
    // Wait for initial dashboard name to load
    const defaultNameHeading = this.page.getByRole('heading', {
      name: 'My Dashboard',
      level: 3,
    });
    await defaultNameHeading.waitFor({ state: 'visible', timeout: 5000 });

    // Double-click to enter edit mode
    await defaultNameHeading.dblclick();

    // Fill in new name
    const nameInput = this.page.locator('input[placeholder="Dashboard Name"]');
    await nameInput.fill(newName);
    await this.page.keyboard.press('Enter');

    // Wait for the name to be saved
    const updatedHeading = this.page.getByRole('heading', {
      name: newName,
      level: 3,
    });
    await updatedHeading.waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Add a new tile to the dashboard
   */
  async addTile() {
    await this.addTileButton.click();
  }

  /**
   * save tile to the dashboard
   */
  async saveTile() {
    await this.saveButton.click();
  }

  /**
   * Create a new dashboard and open the tile editor (add tile), waiting for it to be ready.
   * Use when testing the chart/tile editor modal in isolation.
   */
  async openNewTileEditor() {
    await this.createDashboardButton.click();
    await this.page.waitForURL('**/dashboards**');
    await this.addTileButton.click();
    await expect(this.chartEditor.nameInput).toBeVisible();
    await this.chartEditor.waitForDataToLoad();
  }

  /**
   * Add a tile with specific configuration
   */
  async addTileWithConfig(chartName: string) {
    await this.addTile();

    const chartNameInput = this.page.locator(
      '[data-testid="chart-name-input"]',
    );
    await chartNameInput.fill(chartName);

    const runQueryButton = this.page.locator(
      '[data-testid="chart-run-query-button"]',
    );
    await runQueryButton.click();

    // Wait for query to complete
    await this.page.waitForResponse(
      resp => resp.url().includes('/clickhouse-proxy') && resp.status() === 200,
    );
    // Wait for tile to be added
    await this.saveTile();
  }

  /**
   * Get all dashboard tiles
   */
  getTiles() {
    return this.page.locator('[data-testid^="dashboard-tile-"]');
  }

  /**
   * Get specific tile by index
   */
  getTile(index: number) {
    return this.getTiles().nth(index);
  }

  /**
   * Hover over a tile to reveal action buttons
   */
  async hoverOverTile(index: number) {
    await this.getTile(index).hover();
  }

  /**
   * Get tile action button
   */
  getTileButton(action: 'edit' | 'duplicate' | 'delete' | 'alerts') {
    return this.page.locator(`[data-testid^="tile-${action}-button-"]`).first();
  }

  /**
   * Edit a tile
   */
  async editTile(tileIndex: number) {
    await this.hoverOverTile(tileIndex);
    await this.getTileButton('edit').click();
  }

  /**
   * Duplicate a tile
   */
  async duplicateTile(tileIndex: number) {
    await this.hoverOverTile(tileIndex);
    await this.getTileButton('duplicate').click();

    const confirmButton = this.page.locator(
      '[data-testid="confirm-confirm-button"]',
    );
    await confirmButton.click();
  }

  /**
   * Delete a tile
   */
  async deleteTile(tileIndex: number) {
    await this.hoverOverTile(tileIndex);
    await this.getTileButton('delete').click();

    const confirmButton = this.page.locator(
      '[data-testid="confirm-confirm-button"]',
    );
    await confirmButton.click();
  }

  /**
   * Set global dashboard filter
   */
  async setGlobalFilter(filter: string) {
    await this.searchInput.fill(filter);
    await this.searchSubmitButton.click();
  }

  async saveQueryAndFiltersAsDefault() {
    await this.dashboardMenuButton.click();
    await this.saveDefaultQueryAndFiltersMenuItem.click();
  }

  async removeSavedQueryAndFiltersDefaults() {
    await this.dashboardMenuButton.click();
    await this.removeDefaultQueryAndFiltersMenuItem.click();
  }

  /**
   * Toggle live mode
   */
  async toggleLiveMode() {
    await this.liveButton.click();
  }

  /**
   * Navigate to a dashboard by name from the list
   */
  async goToDashboardByName(name: string) {
    const dashboardLink = this.page.locator(`text="${name}"`);
    await dashboardLink.click();
    await this.page.waitForURL('**/dashboards/**');
  }

  /**
   * Get dashboard name heading by name
   */
  getDashboardHeading(name: string) {
    return this.page.getByRole('heading', { name, level: 3 });
  }

  /**
   * Get chart containers (recharts)
   */
  getChartContainers() {
    return this.page.locator('.recharts-responsive-container');
  }

  /** Open the Edit Filters Modal */
  async openEditFiltersModal() {
    await this.editFiltersButton.click();
  }

  /** Close the Edit Filters Modal */
  async closeFiltersModal() {
    await this.closeFiltersModalButton.click();
  }

  async fillFilterForm(
    name: string,
    sourceName: string,
    expression: string,
    metricType?: string,
  ) {
    const filterNameInput = this.page.getByTestId('filter-name-input');
    await filterNameInput.fill(name);

    await this.filtersSourceSelector.click();
    await this.page
      .getByRole('option', { name: sourceName, exact: true })
      .click();

    const editor = getSqlEditor(this.page, 'expression');
    await editor.click();
    await this.page.keyboard.type(expression);

    if (metricType) {
      await this.page
        .getByRole('radio', { name: metricType, exact: true })
        .click();
    }

    const saveFilterButton = this.page.getByTestId('save-filter-button');
    await saveFilterButton.click();
  }

  async addFilterToDashboard(
    name: string,
    sourceName: string,
    expression: string,
    metricType?: string,
  ) {
    await this.addFiltersButton.click();

    await this.fillFilterForm(name, sourceName, expression, metricType);
  }

  async deleteFilterFromDashboard(name: string) {
    const deleteButton = this.page.getByTestId(`delete-filter-button-${name}`);
    await deleteButton.click();
  }

  async editFilter(
    currentName: string,
    name: string,
    sourceName: string,
    expression: string,
    metricType?: string,
  ) {
    const editButton = this.page.getByTestId(
      `edit-filter-button-${currentName}`,
    );
    await editButton.click();

    await this.fillFilterForm(name, sourceName, expression, metricType);
  }

  getFilterItemByName(name: string) {
    return this.page.getByTestId(`dashboard-filter-item-${name}`);
  }

  getFilterSelectByName(name: string) {
    return this.page.getByTestId(`dashboard-filter-select-${name}`);
  }

  async clickFilterOption(filterName: string, option: string) {
    const serviceFilter = this.getFilterSelectByName(filterName);
    serviceFilter.click();
    const optionLocator = this.page.getByRole('option', {
      name: option,
      exact: true,
    });
    await optionLocator.click();
  }

  /**
   * Get CodeMirror editor by filtering for specific text content
   */
  getCodeMirrorEditor(text: string) {
    return this.page.locator('.cm-content').filter({ hasText: text });
  }

  getChartTypeTab(type: SeriesType) {
    if (type === 'time') {
      return this.page.getByRole('tab', { name: /line/i });
    }
    return this.page.getByRole('tab', { name: new RegExp(type, 'i') });
  }

  /**
   * Convert a config-format tile config to SeriesData for form verification.
   */
  private configToSeriesData(config: TileConfig): SeriesData[] {
    if (config.displayType === 'markdown') {
      return [{ type: 'markdown', content: config.markdown }];
    }

    if (config.displayType === 'search') {
      return [
        {
          type: 'search',
          sourceId: config.sourceId,
          where: config.where,
          whereLanguage: config.whereLanguage ?? 'lucene',
        },
      ];
    }

    const type: SeriesData['type'] =
      config.displayType === 'line' || config.displayType === 'stacked_bar'
        ? 'time'
        : config.displayType;

    const groupBy = config.groupBy ? [config.groupBy] : undefined;
    const selectItems = Array.isArray(config.select) ? config.select : [];

    return selectItems.map(item => ({
      type,
      sourceId: config.sourceId,
      aggFn: item.aggFn,
      where: item.where,
      whereLanguage: item.whereLanguage ?? 'lucene',
      alias: item.alias,
      field: item.valueExpression,
      groupBy,
    }));
  }

  /**
   * Verify tile edit form using the config-format tile config directly,
   * avoiding the need for a separate SeriesData verification array.
   */
  async verifyTileFormFromConfig(
    config: TileConfig,
    expectedSourceName?: string,
  ) {
    await this.verifyTileForm(
      this.configToSeriesData(config),
      expectedSourceName,
    );
  }

  /**
   * Verify tile edit form matches the given series data
   * @param series - Array of series data from the API request
   * @param expectedSourceName - Optional expected source name for verification
   */
  async verifyTileForm(series: SeriesData[], expectedSourceName?: string) {
    for (let i = 0; i < series.length; i++) {
      const seriesData = series[i];

      // Verify markdown content for markdown tiles
      if (seriesData.content) {
        const content = await this.markdownTextarea.first().inputValue();
        expect(content).toContain(seriesData.content);
      }

      const chartTypeTab = this.getChartTypeTab(seriesData.type);
      await expect(chartTypeTab).toHaveAttribute('aria-selected', 'true');

      // Verify source selector for charts with sources
      if (seriesData.sourceId && expectedSourceName) {
        await expect(this.tileSourceSelector).toBeVisible();
        await expect(this.tileSourceSelector).toHaveValue(expectedSourceName);
      }

      // Verify alias
      if (seriesData.alias) {
        await expect(this.aliasInput.nth(i)).toBeVisible();
        await expect(this.aliasInput.nth(i)).toHaveValue(seriesData.alias);
      }

      // Verify aggregation function
      if (seriesData.aggFn) {
        await expect(this.aggFnSelect.nth(i)).toBeVisible();
        await expect(this.aggFnSelect.nth(i)).toHaveValue(
          new RegExp(seriesData.aggFn, 'i'),
        );
      }

      // Verify field expression
      if (seriesData.field) {
        const fieldEditor = this.getCodeMirrorEditor(seriesData.field);
        const fieldValue = await fieldEditor.first().textContent();
        expect(fieldValue).toContain(seriesData.field);
      }

      // Verify where clause (handles both Lucene textarea and SQL CodeMirror)
      if (seriesData.where) {
        if (seriesData.whereLanguage === 'sql') {
          const whereEditor = this.getCodeMirrorEditor(seriesData.where);
          const whereValue = await whereEditor.first().textContent();
          expect(whereValue).toContain(seriesData.where);
        } else {
          const whereTextarea = this.page.locator('textarea').filter({
            hasText: seriesData.where,
          });
          await expect(whereTextarea).toBeVisible();
        }
      }

      // Verify group by
      if (seriesData.groupBy && seriesData.groupBy.length > 0) {
        const groupByEditor = this.getCodeMirrorEditor(seriesData.groupBy[0]);
        const groupByValue = await groupByEditor.first().textContent();
        expect(groupByValue).toContain(seriesData.groupBy[0]);
      }
    }
  }

  // Getters for assertions

  get createButton() {
    return this.createDashboardButton;
  }

  get addNewTileButton() {
    return this.addTileButton;
  }

  get dashboardName() {
    return this.dashboardNameHeading;
  }

  get filterInput() {
    return this.searchInput;
  }

  get filterSubmitButton() {
    return this.searchSubmitButton;
  }

  get temporaryDashboardBanner() {
    return this.tempDashboardBanner;
  }

  get filtersList() {
    return this.filtersListModal;
  }

  get emptyFiltersList() {
    return this.emptyFiltersListModal;
  }

  get unsavedChangesConfirmModal() {
    return this.confirmModal;
  }

  get unsavedChangesConfirmCancelButton() {
    return this.confirmCancelButton;
  }

  get unsavedChangesConfirmDiscardButton() {
    return this.confirmConfirmButton;
  }
}
