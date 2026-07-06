/**
 * ChartExplorerPage - Page object for the chart explorer
 * Encapsulates all interactions with the chart explorer interface. The chart
 * explorer now lives as the "chart" mode of the unified Explore page; the
 * legacy /chart route redirects there.
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
    this.chartForm = page.locator('[data-testid="explore-chart-form"]');
  }

  /**
   * Navigate to the chart explorer (via the legacy /chart redirect)
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

  // Getters for assertions

  get form() {
    return this.chartForm;
  }
}
