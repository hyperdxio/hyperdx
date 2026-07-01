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
   * click the "Add to Filters" line action on a nested key. Mirrors the
   * DBRowJsonViewer line actions: each row carries a hashed `*__line` CSS-module
   * class, and the action is a `<button title="Add to Filters">` revealed only
   * while the row is hovered.
   */
  async addParsedJsonFieldToFilter(parentField: string, nestedKey: string) {
    await this.clickTab('parsed');

    // The nested key only renders as its own line once the parent field (whose
    // value is a JSON string) is expanded. An exact text match avoids matching
    // the collapsed parent's raw-value preview, which contains the key inline.
    const leaf = this.panelContainer.getByText(nestedKey, { exact: true });
    if (
      !(await leaf
        .first()
        .isVisible()
        .catch(() => false))
    ) {
      // Click the parent's key (left side, away from the hover-only action
      // menu) to expand it.
      await this.panelContainer
        .getByText(parentField, { exact: true })
        .first()
        .click();
    }

    await leaf.first().waitFor({ state: 'visible', timeout: 10_000 });
    // Hover the line to mount its action menu, then click the titled button
    // scoped to that line so the parent's menu is never the target.
    await leaf.first().hover();
    const leafLine = leaf
      .first()
      .locator('xpath=ancestor::*[contains(@class,"__line")][1]');
    await leafLine
      .getByTitle(/add to filters/i)
      .first()
      .click({ timeout: 10_000 });
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
