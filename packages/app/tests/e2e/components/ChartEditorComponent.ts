/**
 * ChartEditorComponent - Reusable component for chart/tile editor
 * Used for creating and configuring dashboard tiles and chart explorer
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { Locator, Page } from '@playwright/test';

import { dismissSqlAutocomplete, getSqlEditor } from '../utils/locators';

import { WebhookAlertModalComponent } from './WebhookAlertModalComponent';

export class ChartEditorComponent {
  readonly page: Page;
  readonly addNewWebhookButton: Locator;
  readonly webhookAlertModal: WebhookAlertModalComponent;

  private readonly chartNameInput: Locator;
  private readonly chartTypeInput: Locator;
  private readonly sourceSelector: Locator;
  private readonly metricSelector: Locator;
  private readonly aggFnSelect: Locator;
  private readonly addAlertButton: Locator;
  private readonly removeAlertButton: Locator;
  private readonly webhookSelector: Locator;
  private readonly runQueryButton: Locator;
  private readonly saveButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.chartNameInput = page.getByTestId('chart-name-input');
    this.chartTypeInput = page.getByTestId('chart-type-input');
    this.sourceSelector = page.getByTestId('source-selector');
    this.metricSelector = page.getByTestId('metric-name-selector');
    this.aggFnSelect = page.getByTestId('agg-fn-select');
    this.addAlertButton = page.getByTestId('alert-button');
    this.removeAlertButton = page.getByTestId('remove-alert-button');
    this.webhookSelector = page.getByTestId('select-webhook');
    this.addNewWebhookButton = page.getByTestId('add-new-webhook-button');
    this.webhookAlertModal = new WebhookAlertModalComponent(page);
    this.runQueryButton = page.getByTestId('chart-run-query-button');
    this.saveButton = page.getByTestId('chart-save-button');
  }

  /**
   * Set chart name
   */
  async setChartName(name: string) {
    await this.chartNameInput.fill(name);
  }

  /**
   * Set chart type
   */
  async setChartType(name: DisplayType) {
    // Line and StackedBar share the "Time Series" tab; other display types
    // match their tab label by name (case-insensitive substring).
    const tabName =
      name === DisplayType.Line || name === DisplayType.StackedBar
        ? 'Time Series'
        : name;
    await this.chartTypeInput.getByRole('tab', { name: tabName }).click();
  }

  /**
   * Set group by expression
   */
  async setGroupBy(expression: string) {
    const groupByInput = getSqlEditor(this.page, 'SQL Columns');
    await groupByInput.click();
    await this.page.keyboard.type(expression);
    // Dismiss the autocomplete dropdown so it doesn't linger and overlay the
    // next input (e.g. the ORDER BY editor), which otherwise fails the click's
    // actionability check and times out. Uses blur (not Escape) so it can't
    // close a surrounding drawer (the dashboard tile editor). See the helper.
    await dismissSqlAutocomplete(this.page);
  }

  /**
   * Set a custom ORDER BY expression in the chart editor's ORDER BY input.
   * Available on the Table, Pie, and Bar display types. Clears any existing
   * value first, then types the new expression and dismisses the autocomplete
   * popup so it doesn't swallow the following interaction.
   */
  async setOrderBy(expression: string) {
    const editor = this.page
      .getByTestId('order-by-input')
      .locator('.cm-content');
    // Dismiss any autocomplete popup left open by a prior editor interaction so
    // it can't overlay this editor and stall the click on actionability.
    await dismissSqlAutocomplete(this.page);
    await editor.click();
    // Clear any existing content before typing the new expression.
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.press('Delete');
    await this.page.keyboard.type(expression);
    // Dismiss the autocomplete dropdown so it doesn't intercept the next click.
    await dismissSqlAutocomplete(this.page);
  }

  /**
   * Select a data source
   */
  async selectSource(sourceName: string) {
    await this.sourceSelector.click();
    // Use getByRole for more reliable selection. exact: true avoids matching
    // sources whose names are prefixes of others (e.g. "E2E Traces MV" vs
    // "E2E Traces MV AutoPopulate").
    const sourceOption = this.page.getByRole('option', {
      name: sourceName,
      exact: true,
    });
    if ((await sourceOption.getAttribute('data-combobox-active')) != 'true') {
      await sourceOption.click({ timeout: 5000 });
    }
  }

  /**
   * Select a metric by name
   */
  async selectMetric(metricName: string, metricValue?: string) {
    // Wait for metric selector to be visible
    await this.metricSelector.waitFor({ state: 'visible', timeout: 5000 });

    // Click to open dropdown
    await this.metricSelector.click();

    // Type to filter
    await this.metricSelector.fill(metricName);

    // If a specific metric value is provided, wait for and click it
    if (metricValue) {
      // Use attribute selector for combobox options
      const targetMetricOption = this.page.locator(
        `[data-combobox-option="true"][value="${metricValue}"]`,
      );
      await targetMetricOption.waitFor({ state: 'visible', timeout: 5000 });
      await targetMetricOption.click({ timeout: 5000 });
    } else {
      // Otherwise just press Enter to select the first match
      await this.page.keyboard.press('Enter');
    }
  }

  /**
   * Select an aggregation function from the dropdown
   */
  async selectAggFn(label: string) {
    await this.aggFnSelect.click();
    await this.page.getByRole('option', { name: label }).click();
  }

  /**
   * Get the currently selected aggregation function value
   */
  async getSelectedAggFn(): Promise<string | null> {
    return this.aggFnSelect.inputValue();
  }

  /**
   * Check if an aggregation function option is available in the dropdown
   */
  async isAggFnOptionAvailable(label: string): Promise<boolean> {
    await this.aggFnSelect.click();
    const option = this.page.getByRole('option', { name: label });
    const visible = await option.isVisible().catch(() => false);
    // Close the dropdown
    await this.page.keyboard.press('Escape');
    return visible;
  }

  async clickAddAlert() {
    await this.addAlertButton.click();
    this.addNewWebhookButton.waitFor({
      state: 'visible',
      timeout: 2000,
    });
  }

  async clickRemoveAlert() {
    await this.removeAlertButton.click();
    this.removeAlertButton.waitFor({
      state: 'hidden',
      timeout: 2000,
    });
  }

  async selectWebhook(webhookName: string) {
    if ((await this.webhookSelector.inputValue()) === webhookName) {
      return;
    }
    await this.webhookSelector.click();
    await this.page
      .getByRole('option', { name: webhookName })
      .click({ timeout: 5000 });
  }

  /**
   * Run the query and wait for it to complete
   */
  async runQuery(waitForRecharts: boolean = true) {
    await this.runQueryButton.click();
    if (waitForRecharts) {
      // need to wait for the recharts graph to render
      await this.page
        .locator('.recharts-responsive-container')
        .first()
        .waitFor({ state: 'visible', timeout: 10000 });
    }
  }

  /**
   * Switch the chart editor from Builder to SQL mode.
   */
  async switchToSqlMode() {
    const sqlLabel = this.page.locator(
      '.mantine-SegmentedControl-label:has-text("SQL")',
    );
    await sqlLabel.waitFor({ state: 'visible', timeout: 5000 });
    await sqlLabel.click();
  }

  /**
   * Switch the chart editor from SQL back to Builder mode.
   */
  async switchToBuilderMode() {
    const builderLabel = this.page.locator(
      '.mantine-SegmentedControl-label:has-text("Builder")',
    );
    await builderLabel.waitFor({ state: 'visible', timeout: 5000 });
    await builderLabel.click();
  }

  /**
   * Locator for the CodeMirror content of the SQL template editor. Scoped
   * with .first() because the "Generated SQL" preview accordion further
   * down the DOM renders another `.cm-editor` instance.
   */
  sqlEditorContent(): Locator {
    return this.page.locator('.cm-editor .cm-content').first();
  }

  /**
   * Read the current text of the SQL template editor.
   */
  async getSqlEditorText(): Promise<string> {
    return this.sqlEditorContent().innerText();
  }

  /**
   * Type a SQL query into the CodeMirror SQL editor, replacing any existing
   * contents first. Call switchToSqlMode() first to make the editor visible.
   *
   * Clearing before typing is important: switching Builder → SQL can
   * auto-generate a template into the editor, and appending to it would
   * corrupt the query. This always yields exactly `sql`.
   */
  async typeSqlQuery(sql: string) {
    await this.replaceSqlQuery(sql);
  }

  /**
   * Replace the entire contents of the SQL template editor with `sql`.
   * Selects all existing text and deletes it before typing, so this fully
   * replaces (rather than appends to) any auto-generated or hand-written SQL
   * already in the editor.
   */
  async replaceSqlQuery(sql: string) {
    const sqlContent = this.sqlEditorContent();
    await sqlContent.click();
    await this.page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
    );
    await this.page.keyboard.press('Delete');
    await this.page.keyboard.type(sql);
  }

  /**
   * Save the chart/tile and wait for modal to close
   */
  async save() {
    await this.saveButton.click();
    // Wait for save button to disappear (modal closes)
    await this.saveButton.waitFor({ state: 'hidden', timeout: 2000 });
  }

  /**
   * Wait for chart editor data to load (sources, metrics, etc.)
   */
  async waitForDataToLoad() {
    await this.runQueryButton.waitFor({ state: 'visible', timeout: 2000 });
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Complete workflow: create a basic chart with name and save
   */
  async createBasicChart(name: string) {
    // Wait for data sources to load before interacting
    await this.waitForDataToLoad();
    await this.setChartName(name);
    await this.runQuery();
    await this.save();
  }

  /**
   * Complete workflow: create a chart with specific source and metric
   */
  async createChartWithMetric(
    chartName: string,
    sourceName: string,
    metricName: string,
    metricValue?: string,
  ) {
    // Wait for data sources to load before interacting
    await this.waitForDataToLoad();
    await this.selectSource(sourceName);
    await this.selectMetric(metricName, metricValue);
    await this.runQuery();
    await this.save();
  }

  /**
   * Complete workflow: create a chart with specific source and metric
   */
  async createTable({
    chartName,
    sourceName,
    groupBy,
  }: {
    chartName: string;
    sourceName: string;
    groupBy?: string;
  }) {
    // Wait for data sources to load before interacting
    await this.waitForDataToLoad();

    const tableButton = this.page.getByRole('tab', { name: 'Table' });
    await tableButton.click();

    await this.setChartName(chartName);
    await this.selectSource(sourceName);
    if (groupBy) await this.setGroupBy(groupBy);
    await this.save();
  }

  /**
   * Select a threshold type in the tile alert editor.
   * Pass the option value (e.g. 'between', 'above', 'below').
   * Scoped to [data-testid="alert-details"].
   */
  async selectTileAlertThresholdType(value: string) {
    await this.page
      .getByTestId('alert-details')
      .locator('select')
      .first()
      .selectOption(value);
  }

  /**
   * Set the lower threshold value in the tile alert editor.
   * Mantine v9 NumberInput renders as <input inputmode="decimal"> (not type="number"),
   * so getByRole('spinbutton') does not match. We use the inputmode attribute instead.
   */
  async setTileAlertThreshold(value: number) {
    const input = this.page
      .getByTestId('alert-details')
      .locator('input[inputmode="decimal"]')
      .first();
    await input.fill(String(value));
    await input.blur();
  }

  /**
   * Set the upper threshold (thresholdMax) in the tile alert editor.
   * Only visible after selecting a range threshold type (e.g. 'between').
   * Mantine v9 NumberInput renders as <input inputmode="decimal"> (not type="number"),
   * so getByRole('spinbutton') does not match. We use the inputmode attribute instead.
   */
  async setTileAlertThresholdMax(value: number) {
    const input = this.page
      .getByTestId('alert-details')
      .locator('input[inputmode="decimal"]')
      .nth(1);
    await input.fill(String(value));
    await input.blur();
  }

  /**
   * Set the note field in the tile alert editor.
   */
  async setTileAlertNote(note: string) {
    const noteInput = this.page.getByTestId('alert-note-input');
    await noteInput.fill(note);
  }

  // ---- Row Click Action drawer helpers ----

  /**
   * Open the "Row Click Action" drawer. Only available on Table tiles.
   */
  async openRowClickDrawer() {
    await this.page.getByTestId('onclick-drawer-trigger').click();
    await this.rowClickDrawer.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Switch the Row Click Action mode (SegmentedControl).
   */
  async setRowClickMode(mode: 'Default' | 'Search' | 'Dashboard' | 'External') {
    await this.page
      .getByTestId('onclick-mode-segmented')
      .getByText(mode, { exact: true })
      .click();
  }

  /**
   * Fill the External URL template input in the drawer. Call
   * setRowClickMode('External') first to make the input visible.
   */
  async fillRowClickExternalUrl(urlTemplate: string) {
    await this.page.getByTestId('onclick-external-url-input').fill(urlTemplate);
  }

  /**
   * Select a target (source/dashboard or "Template") from the Row Click
   * Action drawer's Select dropdown. Pass the exact option label — for
   * example "Template", "E2E Logs", or a specific dashboard name.
   */
  async selectRowClickTarget(label: string) {
    await this.page.getByTestId('onclick-target-select').click();
    await this.page.getByRole('option', { name: label, exact: true }).click();
  }

  /**
   * Fill the Template text input in the drawer. Call selectRowClickTarget('Template')
   * first to make the template input visible (this is the default state after
   * switching to Search or Dashboard mode, but calling it explicitly is safe).
   */
  async fillRowClickTemplate(template: string) {
    await this.page.getByTestId('onclick-template-input').fill(template);
  }

  /**
   * Select SQL or Lucene on the WHERE template's language select inside the drawer.
   */
  async setRowClickWhereLanguage(language: 'SQL' | 'Lucene') {
    const select = this.rowClickDrawer
      .getByTestId('where-language-switch')
      .getByLabel('Query language');
    await select.click();
    await this.page
      .getByRole('option', { name: language, exact: true })
      .click();
  }

  /**
   * Fill the WHERE template input in the drawer. Handles both SQL (CodeMirror)
   * and Lucene (textarea) variants of SearchWhereInput.
   */
  async fillRowClickWhereTemplate(
    template: string,
    language: 'sql' | 'lucene',
  ) {
    if (language === 'sql') {
      const editor = this.rowClickDrawer
        .locator('.cm-editor .cm-content')
        .first();
      await editor.click();
      await this.page.keyboard.type(template);
    } else {
      const textarea = this.rowClickDrawer.locator('textarea').first();
      await textarea.fill(template);
    }
  }

  /**
   * Click the drawer's Apply button and wait for the drawer to close.
   */
  async applyRowClickDrawer() {
    await this.page.getByTestId('onclick-apply-button').click();
    await this.rowClickDrawer.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Add a row of filter templates to the Row Click drawer by clicking
   * "Add filter" and filling the expression and template inputs for the
   * newly-added row (placed at position `index`).
   */
  async addOnClickFilterTemplate(
    index: number,
    expression: string,
    template: string,
  ) {
    await this.rowClickDrawer
      .getByRole('button', { name: 'Add filter' })
      .click();
    await this.rowClickDrawer
      .getByTestId('onclick-filter-expression-input')
      .nth(index)
      .fill(expression);
    await this.rowClickDrawer
      .getByTestId('onclick-filter-template-input')
      .nth(index)
      .fill(template);
  }

  /**
   * Read the current value of the expression input for the filter at
   * position `index` within the Row Click drawer.
   */
  onClickFilterExpressionInput(index: number) {
    return this.rowClickDrawer
      .getByTestId('onclick-filter-expression-input')
      .nth(index);
  }

  /**
   * Read the current value of the template input for the filter at
   * position `index` within the Row Click drawer.
   */
  onClickFilterTemplateInput(index: number) {
    return this.rowClickDrawer
      .getByTestId('onclick-filter-template-input')
      .nth(index);
  }

  get rowClickDrawer() {
    return this.page.getByTestId('onclick-drawer');
  }

  /**
   * The Display Settings container. In the dashboard tile editor this is a
   * docked side panel (a Box with `data-testid="display-settings-panel"`); on
   * Chart Explorer it's an overlay Drawer (`role="dialog"`). Match either so the
   * shared helpers work in both contexts.
   */
  get displaySettingsContainer(): Locator {
    return this.page
      .getByTestId('display-settings-panel')
      .or(this.page.getByRole('dialog', { name: 'Display Settings' }));
  }

  /**
   * Click Apply in the open Display Settings panel/drawer and wait for it to close.
   */
  async applyDisplaySettings() {
    const container = this.displaySettingsContainer;
    await container.getByRole('button', { name: 'Apply', exact: true }).click();
    await container.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Set the "Series Limit" value in the Display Settings panel/drawer. On
   * pie/bar builder charts this caps the number of slices/bars displayed. Opens
   * the settings, fills the input, then applies and closes.
   */
  async setSeriesLimit(limit: number) {
    await this.openDisplaySettings();
    await this.displaySettingsContainer
      .getByLabel('Series Limit')
      .fill(String(limit));
    await this.applyDisplaySettings();
  }

  /**
   * Open the Display Settings panel/drawer and wait for it to become visible.
   */
  async openDisplaySettings() {
    await this.page
      .getByRole('button', { name: 'Display Settings', exact: true })
      .click();
    await this.displaySettingsContainer.waitFor({
      state: 'visible',
      timeout: 5000,
    });
  }

  /**
   * Toggle the "Display Group By Columns on Left" checkbox in the open
   * Display Settings drawer to the given state.
   */
  async setGroupByColumnsOnLeft(checked: boolean) {
    const drawer = this.page.getByRole('dialog', { name: 'Display Settings' });
    const checkbox = drawer.getByLabel('Display Group By Columns on Left');
    const isChecked = await checkbox.isChecked();
    if (isChecked !== checked) {
      await checkbox.click();
    }
  }

  /**
   * Click the "Add Series" button to add a new series to the chart.
   */
  async addSeries() {
    await this.page
      .getByRole('button', { name: 'Add Series', exact: true })
      .click();
  }

  /**
   * Click the "Duplicate" button on the series at zero-based `index` to insert
   * a copy of it directly below.
   */
  async duplicateSeries(index: number) {
    await this.page.getByTestId('series-duplicate-button').nth(index).click();
  }

  /**
   * Toggle the "As Ratio" switch. Only visible when the chart has exactly
   * two series.
   */
  async toggleAsRatio() {
    await this.page.getByRole('switch', { name: 'As Ratio' }).click();
  }

  /**
   * Set the alias for a series by zero-based index. Useful for giving two
   * default `count()` series distinct column names in a multi-series table.
   */
  async setSeriesAlias(index: number, alias: string) {
    await this.page.getByTestId('series-alias-input').nth(index).fill(alias);
  }

  /**
   * Read the column header texts from the first <table> in the tile editor
   * preview panel. Waits for the table to be visible before reading.
   */
  async getPreviewTableHeaders(): Promise<string[]> {
    const drawerBody = this.page.locator('.mantine-Drawer-body');
    const table = drawerBody.locator('table').first();
    await table.waitFor({ state: 'visible', timeout: 15000 });
    const headers = await table.locator('thead tr th').allTextContents();
    return headers.map(h => h.trim());
  }

  /**
   * Return the trimmed text of every td at `columnIndex` across all visible
   * data rows of the first table in the tile editor preview panel. Scopes to
   * `tr[data-index]` so the row virtualizer's padding rows (which contain a
   * single colSpan td) are skipped. Waits for at least one data row before
   * reading.
   */
  async getPreviewTableCellTexts(columnIndex: number): Promise<string[]> {
    const drawerBody = this.page.locator('.mantine-Drawer-body');
    const table = drawerBody.locator('table').first();
    await table.waitFor({ state: 'visible', timeout: 15000 });
    await table
      .locator('tbody tr[data-index]')
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
    const cells = await table
      .locator(`tbody tr[data-index] td:nth-child(${columnIndex + 1})`)
      .allTextContents();
    return cells.map(c => c.trim());
  }

  // ---- Number format helpers ----

  /**
   * Select the "Output format" option in whichever number format drawer is
   * currently open (Display Settings OR Series Display Settings). Both drawers
   * embed the same NumberFormatForm with a NativeSelect labeled "Output format".
   */
  async setNumberFormatOutput(label: string) {
    await this.page.getByLabel('Output format').selectOption({ label });
  }

  /**
   * Convenience: open Display Settings drawer, set the chart-wide output format
   * to `label`, then apply and close the drawer.
   */
  async setChartWideNumberFormat(label: string) {
    await this.openDisplaySettings();
    await this.setNumberFormatOutput(label);
    await this.applyDisplaySettings();
  }

  /**
   * Click the per-series format icon button (nth by seriesIndex, 0-based) and
   * wait for the "Series Display Settings" drawer to become visible.
   */
  async openSeriesNumberFormat(seriesIndex: number) {
    await this.page
      .getByRole('button', { name: 'Edit series display format' })
      .nth(seriesIndex)
      .click();
    const drawer = this.page.getByRole('dialog', {
      name: 'Series Display Settings',
    });
    await drawer.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Click the Inherit or Custom segment inside the open
   * "Series Display Settings" drawer.
   */
  async setSeriesFormatMode(mode: 'Inherit' | 'Custom') {
    const drawer = this.page.getByRole('dialog', {
      name: 'Series Display Settings',
    });
    await drawer.getByText(mode, { exact: true }).click();
  }

  /**
   * Click Apply in the open "Series Display Settings" drawer and wait for
   * the drawer to close.
   */
  async applySeriesNumberFormat() {
    const drawer = this.page.getByRole('dialog', {
      name: 'Series Display Settings',
    });
    await drawer.getByRole('button', { name: 'Apply', exact: true }).click();
    await drawer.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Open the per-series format drawer for seriesIndex, switch to Custom mode,
   * set the output format to `output`, then apply.
   */
  async setSeriesNumberFormat(seriesIndex: number, output: string) {
    await this.openSeriesNumberFormat(seriesIndex);
    await this.setSeriesFormatMode('Custom');
    await this.setNumberFormatOutput(output);
    await this.applySeriesNumberFormat();
  }

  /**
   * Open the per-series format drawer for seriesIndex, switch to Inherit
   * (clears any per-series override), then apply.
   */
  async clearSeriesNumberFormat(seriesIndex: number) {
    await this.openSeriesNumberFormat(seriesIndex);
    await this.setSeriesFormatMode('Inherit');
    await this.applySeriesNumberFormat();
  }

  // Getters for assertions

  get nameInput() {
    return this.chartNameInput;
  }

  get source() {
    return this.sourceSelector;
  }

  get metric() {
    return this.metricSelector;
  }

  get aggFn() {
    return this.aggFnSelect;
  }

  get alertButton() {
    return this.addAlertButton;
  }

  get runButton() {
    return this.runQueryButton;
  }

  get saveBtn() {
    return this.saveButton;
  }
}
