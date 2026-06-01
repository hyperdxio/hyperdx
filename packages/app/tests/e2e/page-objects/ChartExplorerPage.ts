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
   * Start recording /clickhouse-proxy requests from this point forward.
   * Call this *after* waitForInitialSettle() so auto-queries on page load
   * are not included.
   */
  startRecordingClickhouseProxyRequests(): {
    getRequests: () => { postData: string | null; url: string }[];
  } {
    const requests: { postData: string | null; url: string }[] = [];
    this.page.on('request', request => {
      if (request.url().includes('/clickhouse-proxy')) {
        requests.push({
          postData: request.postData(),
          url: request.url(),
        });
      }
    });
    return { getRequests: () => requests };
  }

  // Getters for assertions

  get form() {
    return this.chartForm;
  }
}
