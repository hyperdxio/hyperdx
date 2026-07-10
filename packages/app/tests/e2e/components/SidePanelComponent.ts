/**
 * SidePanelComponent - Reusable component for the side panel
 * Used when clicking on log entries, trace spans, or other items that open detail panels
 */
import { Locator, Page } from '@playwright/test';

export class SidePanelComponent {
  readonly page: Page;
  private readonly panelContainer: Locator;
  private readonly tabsContainer: Locator;
  private readonly defaultTimeout: number = 3000;
  constructor(
    page: Page,
    panelTestId: string = 'side-panel',
    defaultTimeout: number = 3000,
  ) {
    this.page = page;
    this.panelContainer = page.getByTestId(panelTestId);
    this.tabsContainer = page.getByTestId('side-panel-tabs');
    this.defaultTimeout = defaultTimeout;
  }

  /**
   * Get the side panel container
   * Usage in spec: await expect(sidePanel.container).toBeVisible()
   */
  get container() {
    return this.panelContainer;
  }

  /**
   * Get the tabs container
   */
  get tabs() {
    return this.tabsContainer;
  }

  /**
   * Get a specific tab by name
   * Usage in spec: await expect(sidePanel.getTab('overview')).toBeVisible()
   */
  getTab(tabName: string) {
    return this.page.getByTestId(`tab-${tabName}`);
  }

  /**
   * Click on a specific tab with proper waiting
   */
  async clickTab(tabName: string) {
    const tab = this.getTab(tabName);
    // Wait for tab to be visible before clicking (fail fast if missing)
    await tab.waitFor({ state: 'visible', timeout: this.defaultTimeout });
    await tab.click({ timeout: this.defaultTimeout });
  }

  /**
   * Navigate through all tabs in sequence
   */
  async navigateAllTabs(tabNames: string[]) {
    for (const tabName of tabNames) {
      await this.clickTab(tabName);
    }
  }

  /**
   * In the parsed JSON view, expand a field whose value is a JSON string, then
   * click the "Add to Filters" line action on a nested key. Each row in the JSON
   * viewer carries `data-testid="json-viewer-line"`, and the action is a
   * `<button title="Add to Filters">` rendered only while the row is hovered.
   */
  async addParsedJsonFieldToFilter(parentField: string, nestedKey: string) {
    await this.clickTab('parsed');

    const lines = this.panelContainer.getByTestId('json-viewer-line');
    // The leaf line is the one containing an element whose text is exactly the
    // nested key. Exact match avoids the collapsed parent's raw-value preview,
    // which contains the key inline as part of a longer string.
    const leafLine = lines.filter({
      has: this.page.getByText(nestedKey, { exact: true }),
    });

    // The nested key only renders as its own line once the parent field (whose
    // value is a JSON string) is expanded. Expand it if the leaf is not showing.
    if (
      !(await leafLine
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      await lines
        .filter({ has: this.page.getByText(parentField, { exact: true }) })
        .first()
        .click();
    }

    await leafLine.first().waitFor({ state: 'visible', timeout: 10_000 });
    // Hover the line to mount its action menu, then click the titled button
    // scoped to that line so the parent's menu is never the target.
    await leafLine.first().hover();
    await leafLine
      .first()
      .getByTitle(/add to filters/i)
      .click({ timeout: 10_000 });
  }

  /**
   * The cross-source "View Trace" action rendered in a log panel's metadata row
   * when the log has trace context (TraceId + a configured trace source).
   */
  get viewTraceButton() {
    return this.page.getByTestId('side-panel-view-trace');
  }

  /**
   * The breadcrumb trail container (rendered by SidePanelBreadcrumbs). Its
   * individual crumbs are `side-panel-breadcrumb-<i>` (0-indexed, root first).
   */
  get breadcrumbs() {
    return this.page.getByTestId('side-panel-breadcrumbs');
  }

  /**
   * Get a breadcrumb crumb by its 0-based index (root = 0). Both clickable
   * (ancestor) and current (leaf) crumbs carry the same test id shape.
   */
  getBreadcrumb(index: number) {
    return this.page.getByTestId(`side-panel-breadcrumb-${index}`);
  }

  /**
   * Click the breadcrumb Back control (pops one navigation level).
   */
  async back() {
    await this.breadcrumbs
      .getByLabel('Back')
      .click({ timeout: this.defaultTimeout });
  }

  /**
   * Click "View Trace" to push the correlated trace onto the source stack.
   */
  async clickViewTrace() {
    // The button stays disabled until the correlated trace source + span row id
    // resolve, so allow a longer window than the default tab-click timeout.
    await this.viewTraceButton.waitFor({ state: 'visible', timeout: 10_000 });
    await this.viewTraceButton.click({ timeout: 10_000 });
  }

  /**
   * Close the side panel (if it has a close button)
   */
  async close() {
    await this.page
      .getByTestId('side-panel-close')
      .click({ timeout: this.defaultTimeout });
  }

  /**
   * Get content area of the side panel
   */
  get content() {
    return this.panelContainer.getByTestId('side-panel-content');
  }
}
