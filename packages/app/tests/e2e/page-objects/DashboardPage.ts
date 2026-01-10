/**
 * DashboardPage - Page object for dashboard pages
 * Encapsulates interactions with dashboard creation, editing, and tile management
 */
import { Locator, Page } from '@playwright/test';

import { ChartEditorComponent } from '../components/ChartEditorComponent';
import { TimePickerComponent } from '../components/TimePickerComponent';

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
  }

  /**
   * Navigate to dashboards list
   */
  async goto() {
    await this.page.goto('/dashboards');
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

    const saveButton = this.page.locator('[data-testid="chart-save-button"]');
    await saveButton.click();

    // Wait for tile to be added
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
}
