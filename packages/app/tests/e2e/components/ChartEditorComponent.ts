/**
 * ChartEditorComponent - Reusable component for chart/tile editor
 * Used for creating and configuring dashboard tiles and chart explorer
 */
import { Locator, Page } from '@playwright/test';

export class ChartEditorComponent {
  readonly page: Page;
  private readonly chartNameInput: Locator;
  private readonly sourceSelector: Locator;
  private readonly metricSelector: Locator;
  private readonly runQueryButton: Locator;
  private readonly saveButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chartNameInput = page.locator('[data-testid="chart-name-input"]');
    this.sourceSelector = page.locator('[data-testid="source-selector"]');
    this.metricSelector = page.locator('[data-testid="metric-name-selector"]');
    this.runQueryButton = page.locator(
      '[data-testid="chart-run-query-button"]',
    );
    this.saveButton = page.locator('[data-testid="chart-save-button"]');
  }

  /**
   * Set chart name
   */
  async setChartName(name: string) {
    await this.chartNameInput.fill(name);
  }

  /**
   * Select a data source
   */
  async selectSource(sourceName: string) {
    await this.sourceSelector.click();
    const sourceOption = this.page.locator(`text=${sourceName}`);
    await sourceOption.click();
  }

  /**
   * Select a metric by name
   */
  async selectMetric(metricName: string, metricValue?: string) {
    // Wait for metric selector to be visible
    await this.metricSelector.waitFor({ state: 'visible', timeout: 5000 });

    // Click to open dropdown
    await this.metricSelector.click();

    // Type to filter
    await this.metricSelector.fill(metricName);

    // If a specific metric value is provided, wait for and click it
    if (metricValue) {
      const targetMetricOption = this.page.locator(
        `[data-combobox-option="true"][value="${metricValue}"]`,
      );
      await targetMetricOption.waitFor({ state: 'visible', timeout: 5000 });
      await targetMetricOption.click();
    } else {
      // Otherwise just press Enter to select the first match
      await this.page.keyboard.press('Enter');
    }
  }

  /**
   * Run the query
   */
  async runQuery() {
    await this.runQueryButton.click();
  }

  /**
   * Save the chart/tile
   */
  async save() {
    await this.saveButton.click();
  }

  /**
   * Complete workflow: create a basic chart with name and save
   */
  async createBasicChart(name: string) {
    await this.setChartName(name);
    await this.runQuery();
    await this.save();
  }

  /**
   * Complete workflow: create a chart with specific source and metric
   */
  async createChartWithMetric(
    chartName: string,
    sourceName: string,
    metricName: string,
    metricValue?: string,
  ) {
    await this.selectSource(sourceName);
    await this.selectMetric(metricName, metricValue);
    await this.runQuery();
    await this.save();
  }

  // Getters for assertions

  get nameInput() {
    return this.chartNameInput;
  }

  get source() {
    return this.sourceSelector;
  }

  get metric() {
    return this.metricSelector;
  }

  get runButton() {
    return this.runQueryButton;
  }

  get saveBtn() {
    return this.saveButton;
  }
}
