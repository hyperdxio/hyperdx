/**
 * ChartEditorComponent - Reusable component for chart/tile editor
 * Used for creating and configuring dashboard tiles and chart explorer
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Locator, Page } from '@playwright/test';

import { getSqlEditor } from '../utils/locators';

import { WebhookAlertModalComponent } from './WebhookAlertModalComponent';

export class ChartEditorComponent {
  readonly page: Page;
  readonly addNewWebhookButton: Locator;
  readonly webhookAlertModal: WebhookAlertModalComponent;

  private readonly chartNameInput: Locator;
  private readonly chartTypeInput: Locator;
  private readonly sourceSelector: Locator;
  private readonly metricSelector: Locator;
  private readonly addOrRemoveAlertButton: Locator;
  private readonly webhookSelector: Locator;
  private readonly runQueryButton: Locator;
  private readonly saveButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chartNameInput = page.getByTestId('chart-name-input');
    this.chartTypeInput = page.getByTestId('chart-type-input');
    this.sourceSelector = page.getByTestId('source-selector');
    this.metricSelector = page.getByTestId('metric-name-selector');
    this.addOrRemoveAlertButton = page.getByTestId('alert-button');
    this.webhookSelector = page.getByTestId('select-webhook');
    this.addNewWebhookButton = page.getByTestId('add-new-webhook-button');
    this.webhookAlertModal = new WebhookAlertModalComponent(page);
    this.runQueryButton = page.getByTestId('chart-run-query-button');
    this.saveButton = page.getByTestId('chart-save-button');
  }

  /**
   * Set chart name
   */
  async setChartName(name: string) {
    await this.chartNameInput.fill(name);
  }

  /**
   * Set chart type
   */
  async setChartType(name: DisplayType) {
    await this.chartTypeInput.getByRole('tab', { name }).click();
  }

  /**
   * Set group by expression
   */
  async setGroupBy(expression: string) {
    const groupByInput = getSqlEditor(this.page, 'SQL Columns');
    await groupByInput.click();
    await this.page.keyboard.type(expression);
  }

  /**
   * Select a data source
   */
  async selectSource(sourceName: string) {
    await this.sourceSelector.click();
    // Use getByRole for more reliable selection
    const sourceOption = this.page.getByRole('option', { name: sourceName });
    if ((await sourceOption.getAttribute('data-combobox-active')) != 'true') {
      await sourceOption.click({ timeout: 5000 });
    }
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
      // Use attribute selector for combobox options
      const targetMetricOption = this.page.locator(
        `[data-combobox-option="true"][value="${metricValue}"]`,
      );
      await targetMetricOption.waitFor({ state: 'visible', timeout: 5000 });
      await targetMetricOption.click({ timeout: 5000 });
    } else {
      // Otherwise just press Enter to select the first match
      await this.page.keyboard.press('Enter');
    }
  }

  async clickAddAlert() {
    await this.addOrRemoveAlertButton.click();
    this.addNewWebhookButton.waitFor({
      state: 'visible',
      timeout: 2000,
    });
  }

  async clickRemoveAlert() {
    await this.addOrRemoveAlertButton.click();
    this.addNewWebhookButton.waitFor({
      state: 'hidden',
      timeout: 2000,
    });
  }

  async selectWebhook(webhookName: string) {
    // Click to open dropdown
    await this.webhookSelector.click();

    // Type to filter
    await this.webhookSelector.fill(webhookName);

    // Use getByRole for more reliable selection
    const sourceOption = this.page.getByRole('option', { name: webhookName });
    if ((await sourceOption.getAttribute('data-combobox-active')) != 'true') {
      await sourceOption.click({ timeout: 5000 });
    }
  }

  /**
   * Run the query and wait for it to complete
   */
  async runQuery() {
    await this.runQueryButton.click();
    // need to wait for the recharts graph to render
    await this.page
      .locator('.recharts-responsive-container')
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });
  }

  /**
   * Save the chart/tile and wait for modal to close
   */
  async save() {
    await this.saveButton.click();
    // Wait for save button to disappear (modal closes)
    await this.saveButton.waitFor({ state: 'hidden', timeout: 2000 });
  }

  /**
   * Wait for chart editor data to load (sources, metrics, etc.)
   */
  async waitForDataToLoad() {
    await this.runQueryButton.waitFor({ state: 'visible', timeout: 2000 });
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Complete workflow: create a basic chart with name and save
   */
  async createBasicChart(name: string) {
    // Wait for data sources to load before interacting
    await this.waitForDataToLoad();
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
    // Wait for data sources to load before interacting
    await this.waitForDataToLoad();
    await this.selectSource(sourceName);
    await this.selectMetric(metricName, metricValue);
    await this.runQuery();
    await this.save();
  }

  /**
   * Complete workflow: create a chart with specific source and metric
   */
  async createTable({
    chartName,
    sourceName,
    groupBy,
  }: {
    chartName: string;
    sourceName: string;
    groupBy?: string;
  }) {
    // Wait for data sources to load before interacting
    await this.waitForDataToLoad();

    const tableButton = this.page.getByRole('tab', { name: 'Table' });
    await tableButton.click();

    await this.setChartName(chartName);
    await this.selectSource(sourceName);
    if (groupBy) await this.setGroupBy(groupBy);
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

  get alertButton() {
    return this.addOrRemoveAlertButton;
  }

  get runButton() {
    return this.runQueryButton;
  }

  get saveBtn() {
    return this.saveButton;
  }
}
