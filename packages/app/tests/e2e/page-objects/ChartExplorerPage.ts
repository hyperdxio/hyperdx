/**
 * ChartExplorerPage - Page object for the /chart page
 * Encapsulates all interactions with the chart explorer interface
 */
import { Locator, Page } from '@playwright/test';

import { ChartEditorComponent } from '../components/ChartEditorComponent';

export class ChartExplorerPage {
  readonly page: Page;
  readonly chartEditor: ChartEditorComponent;
  private readonly chartForm: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chartEditor = new ChartEditorComponent(page);
    this.chartForm = page.locator('[data-testid="chart-explorer-form"]');
  }

  /**
   * Navigate to the chart explorer page
   */
  async goto() {
    await this.page.goto('/chart');
  }

  /**
   * Get chart containers (recharts)
   */
  getChartContainers() {
    return this.page.locator('.recharts-responsive-container');
  }

  /**
   * Get the first chart container
   */
  getFirstChart() {
    return this.getChartContainers().first();
  }

  /**
   * Get the rendered bar rectangles inside the categorical bar chart. One
   * locator per bar, so `.count()` yields the number of bars displayed.
   */
  getBars() {
    return this.page.locator(
      '[data-testid="bar-chart-container"] .recharts-bar-rectangle',
    );
  }

  // Getters for assertions

  get form() {
    return this.chartForm;
  }
}
