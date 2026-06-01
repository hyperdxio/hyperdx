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
   * Wait for the initial page load and any auto-triggered queries to settle
   * before starting to measure subsequent network activity.
   */
  async waitForInitialSettle() {
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Start counting /clickhouse-proxy responses from this point forward.
   * Returns a handle whose `getCount()` returns the tally at any time.
   * Call this *after* waitForInitialSettle() so auto-queries on page load
   * are not included in the count.
   */
  startCountingClickhouseProxyResponses(): { getCount: () => number } {
    let count = 0;
    this.page.on('response', response => {
      if (response.url().includes('/clickhouse-proxy')) {
        count++;
      }
    });
    return { getCount: () => count };
  }

  // Getters for assertions

  get form() {
    return this.chartForm;
  }
}
