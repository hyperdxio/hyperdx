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
