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

  // --- Source settings / metric tables ---

  get nameInput(): Locator {
    return this.page.locator('input[name="name"]');
  }

  /** Picks a source kind via the "Source Data Type" radio group. */
  async selectSourceKind(label: string): Promise<void> {
    await this.page.getByLabel(label, { exact: true }).click();
  }

  /**
   * The Database select. Mantine keeps the form value on a hidden input and
   * renders a separate combobox for interaction, so clicks have to target the
   * combobox (its accessible name comes from the "Database" placeholder).
   */
  get databaseSelect(): Locator {
    return this.page.getByRole('combobox', { name: 'Database' });
  }

  async selectDatabase(databaseName: string): Promise<void> {
    await this.databaseSelect.click();
    await this.page
      .getByRole('option', { name: databaseName, exact: true })
      .click();
  }

  /**
   * Hidden input holding the form value for one OTEL metric type's table
   * ('gauge', 'sum', ...) — use it to assert values, not to click.
   */
  getMetricTableInput(metricType: string): Locator {
    return this.page.locator(`input[name="metricTables.${metricType}"]`);
  }

  /**
   * First metric table combobox (gauge). Disabled while the selected database's
   * table list loads, so it doubles as a readiness signal for autofill, whose
   * only input is that list.
   */
  private get firstMetricTableSelect(): Locator {
    return this.page.getByRole('combobox', { name: 'Table' }).first();
  }

  private get metricTableAutofillNotification(): Locator {
    return this.page
      .locator('.mantine-Notification-root')
      .filter({ hasText: 'Auto-detected metric tables from database.' });
  }

  async waitForMetricTableAutofill(): Promise<void> {
    await expect(this.metricTableAutofillNotification).toBeVisible({
      timeout: 15000,
    });
  }

  /**
   * Asserts metric tables were not autofilled. Anchored on the metric table
   * select being enabled (the database's table list has loaded) plus an idle
   * network, so autofill would have had its input and finished validating
   * candidate tables by the time this resolves.
   */
  async expectNoMetricTableAutofill(): Promise<void> {
    await expect(this.firstMetricTableSelect).toBeEnabled();
    await this.page.waitForLoadState('networkidle');
    await expect(this.metricTableAutofillNotification).toHaveCount(0);
  }
}
