import type { Locator, Page } from '@playwright/test';

import { ChartEditorComponent } from '../components/ChartEditorComponent';

/**
 * Page object for the /explore route.
 *
 * Delegates source/metric selection to ChartEditorComponent (same test-IDs as
 * the dashboard tile editor) and adds explore-specific methods.
 */
export class ExplorePage {
  readonly page: Page;
  readonly chartEditor: ChartEditorComponent;

  constructor(page: Page) {
    this.page = page;
    this.chartEditor = new ChartEditorComponent(page);
  }

  async goto(params?: Record<string, string>) {
    const search = params ? '?' + new URLSearchParams(params).toString() : '';
    await this.page.goto(`/explore${search}`);
  }

  async selectSource(name: string) {
    await this.chartEditor.selectSource(name);
  }

  async selectMetric(metricName: string, metricValue?: string) {
    await this.chartEditor.selectMetric(metricName, metricValue);
  }

  /**
   * Set the group-by via the ExploreGroupByControl FieldPicker.
   * Opens the popover, switches to SQL mode, types the expression, then applies.
   */
  async setGroupBy(expression: string) {
    await this.page.getByTestId('explore-group-by-target').click();
    // Scope to the group-by dialog by role; the accessible name starts with
    // "Group by" and may change as a value is selected, so match with a regex.
    const dropdown = this.page.getByRole('dialog', { name: /^Group by/i });
    await dropdown.waitFor({ state: 'visible', timeout: 5000 });
    // Mantine SegmentedControl hides the actual radio inputs; click the label.
    await dropdown.getByText('SQL', { exact: true }).click();
    const sqlEditor = dropdown.locator('.cm-content');
    await sqlEditor.waitFor({ state: 'visible', timeout: 5000 });
    await sqlEditor.click();
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.press('Delete');
    await this.page.keyboard.type(expression);
    await dropdown.getByRole('button', { name: 'Apply', exact: true }).click();
    await dropdown.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /** Uses search-submit-button, not the chart-run-query-button from the tile editor. */
  async runQuery() {
    await this.page.getByTestId('search-submit-button').click();
    await this.page
      .locator('.recharts-responsive-container')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
  }

  getChartContainer(): Locator {
    return this.page.locator('.recharts-responsive-container').first();
  }

  async countChartSeries(): Promise<number> {
    return this.page
      .locator('.recharts-line, .recharts-area, .recharts-bar')
      .count();
  }

  async clickChartToPin() {
    const surface = this.page.locator('.recharts-surface').first();
    await surface.waitFor({ state: 'visible', timeout: 10000 });
    const box = await surface.boundingBox();
    if (!box) throw new Error('recharts-surface bounding box is null');
    const x = box.x + box.width * 0.5;
    const y = box.y + box.height * 0.4;
    // Move first so recharts processes the mousemove and records an active
    // coordinate; wait for the hover tooltip to confirm it before clicking.
    await this.page.mouse.move(x, y);
    await this.page
      .getByTestId('chart-tooltip')
      .waitFor({ state: 'visible', timeout: 5000 });
    await this.page.mouse.click(x, y);
  }

  /** Only rendered when the active source is a metric source. */
  async openChartSettings() {
    await this.page.getByTestId('explore-chart-settings-button').click();
  }

  getChartSettingsDrawer(): Locator {
    return this.page.getByRole('dialog');
  }

  /** "Alignment" is the label on the GranularityPicker Select, not a checkbox. */
  getAlignmentControl(): Locator {
    return this.getChartSettingsDrawer().getByText('Alignment', {
      exact: true,
    });
  }

  async selectGranularity(label: string) {
    await this.getChartSettingsDrawer()
      .getByTestId('granularity-picker')
      .click();
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  async applyChartSettings() {
    await this.getChartSettingsDrawer()
      .getByTestId('display-settings-apply-button')
      .click();
  }

  getPinnedTooltip(): Locator {
    return this.page.getByTestId('chart-tooltip');
  }

  private getSeriesActionsButtons(): Locator {
    return this.getPinnedTooltip().locator(
      '[data-testid^="chart-series-actions-"]',
    );
  }

  getFirstSeriesActionsButton(): Locator {
    return this.getSeriesActionsButtons().first();
  }

  async countSeriesActionButtons(): Promise<number> {
    return this.getSeriesActionsButtons().count();
  }

  /**
   * Open the first series action menu and return the dataKey from its test-id.
   * Leaves the menu open for the caller to interact with.
   */
  async openFirstSeriesActionsMenu(): Promise<string> {
    const btn = this.getFirstSeriesActionsButton();
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    const testId = (await btn.getAttribute('data-testid')) ?? '';
    const dataKey = testId.replace('chart-series-actions-', '');
    await btn.click();
    return dataKey;
  }

  getViewRelatedLogsLink(dataKey: string): Locator {
    return this.page.getByTestId(`chart-view-events-link-${dataKey}`);
  }

  getViewRelatedTracesLink(dataKey: string): Locator {
    return this.page.getByTestId(`chart-view-traces-link-${dataKey}`);
  }

  /**
   * Parse the "View related logs" href into a URL.
   * `source` is a MongoDB ObjectId in full-stack mode, not a human-readable name.
   */
  async getRelatedLogsUrl(dataKey: string): Promise<URL | null> {
    const href =
      await this.getViewRelatedLogsLink(dataKey).getAttribute('href');
    return href ? new URL(href, 'http://localhost') : null;
  }

  async getRelatedTracesUrl(dataKey: string): Promise<URL | null> {
    const href =
      await this.getViewRelatedTracesLink(dataKey).getAttribute('href');
    return href ? new URL(href, 'http://localhost') : null;
  }

  async filterToSeries(dataKey: string) {
    await this.page.getByTestId(`chart-focus-series-${dataKey}`).click();
  }

  getFirstActiveFilterPill(): Locator {
    return this.page.locator('[data-testid^="active-filter-pill-"]').first();
  }
}
