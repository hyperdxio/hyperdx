/**
 * SourceFormComponent - Component for the materialized view configuration section
 * rendered inside the source edit modal (TableSourceForm).
 *
 * Open the modal first via SearchPage.openEditSourceModal(), then use this
 * component to interact with the MV configuration blocks.
 */
import { expect, Locator, Page } from '@playwright/test';

export class SourceFormComponent {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async addMaterializedView(): Promise<void> {
    await this.page
      .locator('[data-testid="add-materialized-view-button"]')
      .click();
  }

  getMvSection(index: number): Locator {
    return this.page.locator(
      `[data-testid="mv-form-section"][data-mv-index="${index}"]`,
    );
  }

  async selectMvTable(index: number, tableName: string): Promise<void> {
    const section = this.getMvSection(index);
    await section.locator('[data-testid="mv-table-select"]').click();
    await this.page
      .getByRole('option', { name: tableName, exact: true })
      .click();
  }

  getGranularityInput(index: number): Locator {
    return this.getMvSection(index)
      .locator('[data-testid="mv-granularity-select"]')
      .locator('input')
      .first();
  }

  getDimensionColumnsEditor(index: number): Locator {
    return this.getMvSection(index)
      .locator('[data-testid="mv-dimension-columns"]')
      .locator('.cm-content');
  }

  getTimestampColumnEditor(index: number): Locator {
    return this.getMvSection(index)
      .locator('[data-testid="mv-timestamp-column"]')
      .locator('.cm-content');
  }

  getAggregatedColumnFnSelects(index: number): Locator {
    return this.getMvSection(index).locator(
      '[data-testid="mv-aggregated-column-fn"]',
    );
  }

  async waitForInferenceSuccess(): Promise<void> {
    const notification = this.page
      .locator('.mantine-Notification-root')
      .filter({
        hasText: 'Partially inferred materialized view configuration',
      });
    await expect(notification).toBeVisible({ timeout: 15000 });
  }
}
