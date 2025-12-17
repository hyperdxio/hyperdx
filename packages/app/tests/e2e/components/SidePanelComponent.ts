/**
 * SidePanelComponent - Reusable component for the side panel
 * Used when clicking on log entries, trace spans, or other items that open detail panels
 */
import { Locator, Page } from '@playwright/test';

export class SidePanelComponent {
  readonly page: Page;
  private readonly panelContainer: Locator;
  private readonly tabsContainer: Locator;

  constructor(page: Page, panelTestId: string = 'side-panel') {
    this.page = page;
    this.panelContainer = page.locator(`[data-testid="${panelTestId}"]`);
    this.tabsContainer = page.locator('[data-testid="side-panel-tabs"]');
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
    return this.page.locator(`[data-testid="tab-${tabName}"]`);
  }

  /**
   * Click on a specific tab
   */
  async clickTab(tabName: string) {
    await this.getTab(tabName).click();
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
    await this.page.locator('[data-testid="side-panel-close"]').click();
  }

  /**
   * Get content area of the side panel
   */
  get content() {
    return this.panelContainer.locator('[data-testid="side-panel-content"]');
  }
}
