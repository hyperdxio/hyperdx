/**
 * MaterializedViewComponent - Component for the MV acceleration indicator and modal.
 *
 * The indicator renders in two variants:
 *   - badge variant  – inside the chart editor (after a query runs)
 *   - icon variant   – inside each dashboard tile (after the tile auto-queries)
 *
 * Pass an optional scope Locator (e.g. dashboardPage.getTile(0)) to narrow the
 * indicator search to a specific sub-tree. Without a scope the search is page-wide,
 * which is correct for the chart editor (there is exactly one indicator on the page).
 */
import { expect, Locator, Page } from '@playwright/test';

export class MaterializedViewComponent {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ---- Indicator helpers ----

  getIndicator(scope?: Locator): Locator {
    if (scope) {
      return scope.locator('[data-testid="mv-optimization-indicator"]');
    }
    return this.page.locator('[data-testid="mv-optimization-indicator"]');
  }

  async expectAccelerated(scope?: Locator): Promise<void> {
    const indicator = this.getIndicator(scope);
    await expect(indicator).toBeVisible({ timeout: 15000 });
    await expect(indicator).toHaveAttribute('data-mv-accelerated', 'true');
  }

  async openModal(scope?: Locator): Promise<void> {
    await this.getIndicator(scope).click();
    await expect(this.getModal()).toBeVisible({ timeout: 10000 });
  }

  // ---- Modal helpers ----

  getModal(): Locator {
    return this.page.locator('[data-testid="mv-optimization-modal"]');
  }

  getModalItem(tableName: string): Locator {
    return this.page.locator(
      `[data-testid="mv-optimization-modal-item"][data-mv-table="${tableName}"]`,
    );
  }

  getStatusBadge(tableName: string): Locator {
    return this.getModalItem(tableName).locator(
      '[data-testid="mv-optimization-modal-status"]',
    );
  }

  async expandModalItem(tableName: string): Promise<void> {
    const item = this.getModalItem(tableName);
    const ariaExpanded = await item.getAttribute('aria-expanded');
    if (ariaExpanded !== 'true') {
      await item.click();
    }
  }

  async expectStatus(
    tableName: string,
    status: 'active' | 'incompatible' | 'skipped',
  ): Promise<void> {
    const badge = this.getStatusBadge(tableName);
    await expect(badge).toHaveAttribute('data-mv-status', status);
    const statusText = status.charAt(0).toUpperCase() + status.slice(1);
    await expect(badge).toContainText(statusText);
  }

  // ---- Config summary helpers (visible after expanding an accordion item) ----

  getGranularityPill(granularity: string = '1 minute'): Locator {
    return this.getModal().getByText(granularity, { exact: true }).first();
  }

  getDimensionPill(name: string): Locator {
    return this.getModal().getByText(name, { exact: true }).first();
  }

  getAggregatedColumnsTable(): Locator {
    return this.getModal().locator('table');
  }
}
