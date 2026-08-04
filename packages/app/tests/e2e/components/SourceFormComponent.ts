/**
 * SourceFormComponent - Component for the TableSourceForm (source create/edit).
 *
 * Covers both the materialized view configuration section and the OTEL metrics
 * table selectors.
 *
 * Open the form first via SearchPage.openEditSourceModal() (edit) or
 * SearchPage.openCreateSourceModal() (create), then use this component to
 * interact with the form.
 */
import { expect, Locator, Page } from '@playwright/test';

export class SourceFormComponent {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // --- OTEL metrics table selectors -------------------------------------

  /**
   * Hidden input backing a metric-table Mantine Select. Its value is the
   * currently selected ClickHouse table name (empty string when unset).
   * `metricType` is the lower-cased MetricsDataType key, e.g. 'gauge', 'sum',
   * or 'exponential histogram'.
   */
  getMetricTableInput(metricType: string): Locator {
    return this.page.locator(`input[name="metricTables.${metricType}"]`);
  }

  /**
   * The Mantine Select control (root) for a metric table, targeted via the
   * data-testid wired in MetricTableModelForm.
   */
  getMetricTableSelect(metricType: string): Locator {
    return this.page.getByTestId(`metric-table-select-${metricType}`);
  }

  /**
   * Open a metric-table dropdown. The options only render once the ClickHouse
   * table list for the selected database has loaded, so awaiting an option
   * afterwards is a deterministic signal that the table list is available
   * (and therefore that autofill inference has had its chance to run).
   */
  async openMetricTableDropdown(metricType: string): Promise<void> {
    await this.getMetricTableSelect(metricType).click();
  }

  getTableOption(tableName: string): Locator {
    return this.page.getByRole('option', { name: tableName, exact: true });
  }

  // --- Database selector ------------------------------------------------

  /**
   * The form's Database Select. This is the visible combobox (named after its
   * placeholder); the `from.databaseName` input Mantine renders alongside it is
   * hidden, so it can be read but not clicked.
   */
  getDatabaseSelect(): Locator {
    return this.page.getByRole('combobox', { name: 'Database' });
  }

  /** Pick a database from the Database dropdown, as a user would. */
  async selectDatabase(databaseName: string): Promise<void> {
    await this.getDatabaseSelect().click();
    await this.page
      .getByRole('option', { name: databaseName, exact: true })
      .click();
  }

  /**
   * Notification shown when the metrics source form auto-detects (infers)
   * metric tables from the selected database's schema.
   */
  getMetricAutoDetectNotification(): Locator {
    return this.page.locator('.mantine-Notification-root').filter({
      hasText: 'Auto-detected metric tables from database.',
    });
  }

  async waitForMetricAutoDetectSuccess(): Promise<void> {
    await expect(this.getMetricAutoDetectNotification()).toBeVisible({
      timeout: 15000,
    });
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
