/**
 * ChartEditorComponent - Reusable component for chart/tile editor
 * Used for creating and configuring dashboard tiles and chart explorer
 */
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { expect, Locator, Page } from '@playwright/test';

import {
  dismissSqlAutocomplete,
  getSqlEditor,
  replaceEditorText,
} from '../utils/locators';
import { switchWhereToLucene } from '../utils/lucene-autocomplete';

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
    // Line and StackedBar share the "Time Series" tab, and EventPatterns' tab
    // is labelled just "Patterns"; the rest match their tab label by name
    // (case-insensitive substring).
    const tabName =
      name === DisplayType.Line || name === DisplayType.StackedBar
        ? 'Time Series'
        : name === DisplayType.EventPatterns
          ? 'Patterns'
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
    // close a surrounding modal (the dashboard tile editor). See the helper.
    await dismissSqlAutocomplete(this.page);
  }

  /**
   * The chart editor's root, in either place it renders: the dashboard's tile
   * editor modal or the chart explorer page. Inputs that also exist outside it
   * — most notably the dashboard's own search WHERE input, sitting behind the
   * modal where the overlay swallows every click — must stay out of reach.
   */
  private editorForm(): Locator {
    return this.page.locator(
      '[data-testid="tile-editor-form"], [data-testid="chart-explorer-form"]',
    );
  }

  /**
   * The editor renders one WHERE input per series (the series' agg condition)
   * followed by the chart-level WHERE, and they share a placeholder and testid.
   * `'series'` takes the first, `'chart'` the last — so `'series'` only
   * addresses the first series, which is all the tests need so far.
   */
  private whereInput(locator: Locator, scope: 'chart' | 'series'): Locator {
    return scope === 'series' ? locator.first() : locator.last();
  }

  /**
   * A whole WHERE input — its language switch, the SQL or Lucene editor, and
   * anything the input renders beside them. Located from the language switch,
   * which is the one part present in both languages and whichever state the
   * editor is in.
   */
  private whereRow(scope: 'chart' | 'series' = 'chart'): Locator {
    return this.whereInput(
      this.editorForm().getByTestId('where-language-switch'),
      scope,
    ).locator('xpath=..');
  }

  /** The warning icon a WHERE input shows about the variables it references. */
  whereVariableWarning(scope: 'chart' | 'series' = 'chart'): Locator {
    return this.whereRow(scope).getByTestId('variable-validation');
  }

  /**
   * What a WHERE input says about the dashboard variables its expression
   * references, or '' when it flags nothing.
   */
  async getWhereVariableWarning(
    scope: 'chart' | 'series' = 'chart',
  ): Promise<string> {
    const messages = await this.whereVariableWarning(scope).evaluateAll(
      elements =>
        elements.map(element => element.getAttribute('aria-label') ?? ''),
    );
    return messages.join(' ');
  }

  /**
   * Select SQL or Lucene on a WHERE input. Both inputs default to Lucene.
   */
  async setWhereLanguage(
    language: 'SQL' | 'Lucene',
    scope: 'chart' | 'series' = 'chart',
  ) {
    // A completion popup left open by a prior editor can overlay the switch.
    await dismissSqlAutocomplete(this.page);
    const select = this.whereInput(
      this.editorForm().getByTestId('where-language-switch'),
      scope,
    ).getByLabel('Query language');
    await select.click();
    await this.page
      .getByRole('option', { name: language, exact: true })
      .click();
  }

  /** Focus a WHERE input and replace its contents with `expression`. */
  private async fillWhereEditor(expression: string, scope: 'chart' | 'series') {
    // Located through the row rather than the placeholder, which CodeMirror
    // drops as soon as there is content — so this can refill an input it has
    // already filled once.
    const editor = this.whereRow(scope).locator('.cm-content');
    await editor.click();
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.press('Delete');
    await this.page.keyboard.type(expression);
  }

  /**
   * Type a SQL WHERE clause into a WHERE input, replacing any existing
   * contents. Switches the input to SQL first.
   */
  async setSqlWhere(expression: string, scope: 'chart' | 'series' = 'chart') {
    await this.setWhereLanguage('SQL', scope);
    await this.fillWhereEditor(expression, scope);
    await dismissSqlAutocomplete(this.page);
  }

  /**
   * Type into a WHERE input while it is in Lucene mode, where it renders as a
   * plain textarea rather than CodeMirror. Leaves the suggestion dropdown open.
   */
  async typeLuceneWhere(text: string, scope: 'chart' | 'series' = 'chart') {
    const input = this.whereInput(
      this.editorForm().getByPlaceholder(/Search your events w\/ Lucene/i),
      scope,
    );
    await input.click();
    await input.fill(text);
  }

  /**
   * Type `prefix` into a SQL WHERE input to open its autocomplete popup, and
   * report what it offers plus the help panel of the highlighted suggestion.
   *
   * Empties the input and closes the popup before returning: the tooltip sits
   * over the editor and would intercept the next interaction.
   */
  async readWhereCompletions(
    prefix: string,
    scope: 'chart' | 'series' = 'chart',
  ): Promise<{ labels: string[]; info: string }> {
    await this.setWhereLanguage('SQL', scope);
    await this.fillWhereEditor(prefix, scope);

    const popup = this.page.locator('.cm-tooltip-autocomplete');
    await popup.waitFor({ state: 'visible', timeout: 10000 });
    const labels = await this.sqlCompletionOptions().allInnerTexts();

    const infoPanel = this.page.locator('.cm-completionInfo');
    const info =
      (await infoPanel.count()) > 0
        ? (await infoPanel.innerText()).replace(/\s+/g, ' ').trim()
        : '';

    // The editor still has focus, so clear it from the keyboard rather than
    // re-locating it: a non-empty editor no longer shows its placeholder.
    await this.page.keyboard.press('ControlOrMeta+A');
    await this.page.keyboard.press('Backspace');
    await popup.waitFor({ state: 'hidden', timeout: 10000 });

    return { labels, info };
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
   * The tile-editor modal. Series-level lookups have to be scoped to it: the
   * dashboard behind it renders its own WHERE input with identical markup.
   * Only meaningful on a dashboard — the chart explorer has no modal.
   */
  private get tileEditor() {
    return this.page
      .getByRole('dialog')
      .filter({ has: this.page.getByTestId('chart-name-input') });
  }

  /**
   * Set the tile's own filter, which a time chart stores as its series'
   * `aggCondition` rather than in the config's statement-level `where`.
   *
   * Switches to Lucene first for two reasons: the mode is sticky (it is kept in
   * localStorage, so a previous spec can leave it on SQL), and
   * `series-where-input` exists only on the Lucene branch of SearchWhereInput —
   * the SQL branch renders a CodeMirror that carries no test id.
   */
  async setSeriesWhere(condition: string) {
    const editor = this.tileEditor;
    await switchWhereToLucene(editor.getByTestId('where-language-switch'));

    const input = editor.getByTestId('series-where-input');
    await expect(input).toBeVisible();
    await input.fill(condition);
    // Blur to close the suggestion dropdown, which otherwise overlays the
    // Run/Save buttons and fails their actionability check. Escape would bubble
    // to the tile-editor modal and close it.
    await input.blur();
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
   * Switch the chart editor to PromQL mode. Only offered when the app is run
   * with NEXT_PUBLIC_ENABLE_PROMQL=true (the e2e webServer sets it).
   *
   * Matched exactly: "SQL" is a substring of the PromQL label, so a
   * `has-text("SQL")` selector would resolve to both.
   */
  async switchToPromqlMode() {
    const label = this.page
      .locator('.mantine-SegmentedControl-label')
      .filter({ hasText: /^PromQL$/ });
    await label.waitFor({ state: 'visible', timeout: 5000 });
    await label.click();
  }

  /**
   * Select the PromQL editor's data source.
   *
   * Located by role rather than by the `source-selector` test id: that id is on
   * the builder's source select (ChartEditorControls), and PromQL mode renders
   * its own `SourceSelectControlled` which doesn't carry it.
   */
  async selectPromqlSource(sourceName: string) {
    await this.page.getByRole('combobox', { name: 'Data Source' }).click();
    await this.page
      .getByRole('option', { name: sourceName, exact: true })
      .click();
  }

  /**
   * Replace the entire contents of the PromQL expression editor.
   *
   * The same `.cm-editor` locator as the SQL template, and `.first()` for the
   * same reason: the expression input is above the preview panel, whose
   * "Generated PromQL" accordion holds a second, read-only CodeMirror.
   */
  async replacePromqlExpression(expression: string) {
    await replaceEditorText(
      this.page,
      this.page.locator('.cm-editor .cm-content').first(),
      expression,
    );
  }

  /** Read the current text of the PromQL expression editor. */
  async getPromqlEditorText(): Promise<string> {
    return this.page.locator('.cm-editor .cm-content').first().innerText();
  }

  /**
   * The warning icon the PromQL expression input shows about the variables it
   * references.
   *
   * Scoped to the editor form, which in PromQL mode renders the expression
   * input and no WHERE inputs — so this is the only indicator inside it. The
   * validation debounces, so assertions on it need a generous timeout.
   */
  promqlVariableWarning(): Locator {
    return this.editorForm().getByTestId('variable-validation');
  }

  /**
   * Type `prefix` into the PromQL editor and return the labels its
   * autocomplete popup offers, once `settleOn` is among them.
   *
   * Waiting on a known label rather than on the popup is what makes this
   * safe to read as a whole: three sources feed the popup — dashboard
   * variables, metric names and PromQL's own functions and keywords — and the
   * metric-name one debounces, so the list repaints after first appearing.
   *
   * The prefix is re-typed until the label shows up, rather than waited on in
   * place: the metric names arrive from a query, and the source that reads
   * them only joins the `override` array once they do. A popup opened before
   * that lists the other two sources and never repaints on its own, so only a
   * fresh input event can pick the metric names up.
   *
   * Assert the result with `toContain` rather than comparing it whole: which
   * of PromQL's built-ins fuzzy-match a short prefix is not worth pinning.
   */
  async readPromqlCompletions(
    prefix: string,
    settleOn: string,
  ): Promise<string[]> {
    const options = this.completionOptions();
    await expect(async () => {
      // Only on a retry, and only if the last attempt left the popup up: it
      // covers the editor, so `replacePromqlExpression`'s click would land on
      // an option instead. Unconditional dismissal would send keystrokes
      // before the editor has been focused at all.
      if (await this.page.locator('.cm-tooltip-autocomplete').isVisible()) {
        await this.dismissCompletion();
      }
      await this.replacePromqlExpression(prefix);
      await expect(options.filter({ hasText: settleOn })).not.toHaveCount(0, {
        timeout: 5000,
      });
    }).toPass({ timeout: 30000 });
    return options.allInnerTexts();
  }

  /**
   * Type `prefix` into the PromQL editor, accept the suggestion labelled
   * `label`, and return the resulting expression.
   *
   * Verifies that what a completion inserts is well-formed: the replace range
   * reaches forward over the rest of the reference, so the `}` the editor
   * auto-inserts after `${` is inside it and `apply` has to supply its own.
   */
  async acceptPromqlCompletion(prefix: string, label: string): Promise<string> {
    await this.replacePromqlExpression(prefix);

    const option = this.page
      .locator('.cm-tooltip-autocomplete > ul > li')
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .first();
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();

    const text = await this.getPromqlEditorText();
    // Accepting can immediately re-open the popup on the inserted text, which
    // would intercept the next caller's click.
    await this.dismissCompletion();
    return text;
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
   * Expand the "Generated SQL" accordion in the preview panel. Safe to call
   * when it is already open.
   */
  async openGeneratedSql() {
    const control = this.page.getByRole('button', { name: 'Generated SQL' });
    await control.waitFor({ state: 'visible', timeout: 10000 });
    if ((await control.getAttribute('aria-expanded')) !== 'true') {
      await control.click();
    }
    await this.generatedSqlContent().waitFor({
      state: 'visible',
      timeout: 10000,
    });
  }

  /**
   * Expand the "Sample Matched Events" accordion in the preview panel. Safe to
   * call when it is already open. The table only queries once expanded.
   */
  async openSampleMatchedEvents() {
    const control = this.page.getByRole('button', {
      name: 'Sample Matched Events',
    });
    await control.waitFor({ state: 'visible', timeout: 10000 });
    if ((await control.getAttribute('aria-expanded')) !== 'true') {
      await control.click();
    }
  }

  /** CodeMirror content of the rendered "Generated SQL" preview. */
  generatedSqlContent(): Locator {
    return this.page.getByTestId('chart-sql-preview').locator('.cm-content');
  }

  /**
   * The generated SQL as a single whitespace-collapsed line, so assertions
   * don't depend on how sql-formatter happened to wrap the query.
   */
  async getGeneratedSqlText(): Promise<string> {
    const text = await this.generatedSqlContent().innerText();
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Expand the "Generated PromQL" accordion in the preview panel, where a
   * PromQL tile shows what "Generated SQL" shows for the other kinds. Safe to
   * call when it is already open.
   *
   * Rendered off the *queried* config, like that one, so it only appears once
   * the tile has been run.
   */
  async openGeneratedPromql() {
    const control = this.generatedPromqlControl();
    await control.waitFor({ state: 'visible', timeout: 10000 });
    if ((await control.getAttribute('aria-expanded')) !== 'true') {
      await control.click();
    }
    await this.generatedPromqlContent().waitFor({
      state: 'visible',
      timeout: 10000,
    });
  }

  /**
   * The "Generated PromQL" accordion's control. Present for the whole time the
   * editor is in PromQL mode, and disabled until a PromQL query has run.
   */
  generatedPromqlControl(): Locator {
    return this.page.getByRole('button', { name: 'Generated PromQL' });
  }

  /**
   * CodeMirror content of the "Generated PromQL" preview.
   *
   * Its own test id rather than `.cm-editor` with an index: the editor page
   * can hold several CodeMirror instances, and which ordinal this one takes
   * depends on the mode the editor is in.
   */
  generatedPromqlContent(): Locator {
    return this.page.getByTestId('chart-promql-preview').locator('.cm-content');
  }

  /**
   * The generated PromQL as a single whitespace-collapsed line. Substitution is
   * debounced by 300ms, so assert on it with `toPass` or an expect timeout.
   */
  async getGeneratedPromqlText(): Promise<string> {
    const text = await this.generatedPromqlContent().innerText();
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * The raw SQL validation banner. Absent from the DOM entirely when the
   * template raises neither an error nor a warning.
   */
  sqlValidationBanner(): Locator {
    return this.page.getByTestId('raw-sql-validation');
  }

  /**
   * The validation banner's messages as one whitespace-collapsed string.
   * Validation is debounced by 300ms, so assert with `toPass`.
   */
  async getSqlValidationText(): Promise<string> {
    const banner = this.sqlValidationBanner();
    if ((await banner.count()) === 0) return '';
    return (await banner.innerText()).replace(/\s+/g, ' ').trim();
  }

  /**
   * Type `prefix` into the SQL editor to open the autocomplete popup, and
   * report the info panel of the highlighted suggestion.
   *
   * Dismisses the popup and clears the editor before returning: the tooltip
   * sits over the editor and would intercept the next caller's click.
   *
   * `overflowX` is how far the content extends past the panel's own box, so a
   * caller can assert the help text stays inside its background.
   */
  async readSqlCompletionInfo(
    prefix: string,
  ): Promise<{ text: string; overflowX: number }> {
    await this.replaceSqlQuery(prefix);

    const info = this.page.locator('.cm-completionInfo');
    await info.waitFor({ state: 'visible', timeout: 10000 });

    const text = await info.innerText();
    const overflowX = await info.evaluate(
      el => el.scrollWidth - el.clientWidth,
    );

    await this.dismissSqlCompletion();

    return { text, overflowX };
  }

  /**
   * Close the autocomplete popup by emptying the editor, leaving it clean for
   * the next interaction.
   *
   * The popup sits over the editor and intercepts clicks, so anything that
   * opens one has to close it. Emptying the document is the way to do that:
   * Escape also closes it, but it bubbles to the tile modal and pops the
   * discard-changes dialog.
   */
  async dismissCompletion() {
    await this.page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+A' : 'Control+A',
    );
    await this.page.keyboard.press('Backspace');
    await this.page
      .locator('.cm-tooltip-autocomplete')
      .waitFor({ state: 'hidden', timeout: 10000 });
  }

  /** `dismissCompletion` under its original, SQL-specific name. */
  async dismissSqlCompletion() {
    await this.dismissCompletion();
  }

  /**
   * Labels currently offered by the autocomplete popup.
   *
   * Not scoped to a particular editor: CodeMirror portals the tooltip out of
   * the editor it belongs to, and only one is ever open at a time.
   */
  completionOptions(): Locator {
    return this.page.locator(
      '.cm-tooltip-autocomplete > ul > li .cm-completionLabel',
    );
  }

  /** `completionOptions` under its original, SQL-specific name. */
  sqlCompletionOptions(): Locator {
    return this.completionOptions();
  }

  /**
   * Type `prefix` into the SQL editor, accept the suggestion labelled `label`,
   * and return the resulting document text.
   *
   * Verifies that what a completion inserts is actually well-formed — the
   * replace range extends over trailing identifier characters, so a bracket
   * auto-inserted by the editor is inside it and `apply` has to supply its own.
   */
  async acceptSqlCompletion(prefix: string, label: string): Promise<string> {
    await this.replaceSqlQuery(prefix);

    const option = this.page
      .locator('.cm-tooltip-autocomplete > ul > li')
      .filter({ has: this.page.getByText(label, { exact: true }) })
      .first();
    await option.waitFor({ state: 'visible', timeout: 10000 });
    await option.click();

    const text = await this.getSqlEditorText();
    // Accepting can immediately re-open the popup on the inserted text, which
    // would intercept the next caller's click.
    await this.dismissSqlCompletion();
    return text;
  }

  /** The "SQL Chart Instructions" panel, which documents params and macros. */
  sqlInstructions(): Locator {
    return this.page
      .locator('div')
      .filter({ hasText: /^SQL Chart Instructions/ })
      .first();
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

  /** The badge the alert block shows when the tile's query has a warning. */
  alertWarningBadge(): Locator {
    return this.page
      .getByTestId('alert-details')
      .getByText('Warning', { exact: true });
  }

  /**
   * What the alert block's warning badge says, or '' when it shows none. The
   * message only exists as a tooltip, so this hovers the badge to read it.
   */
  async getAlertWarning(): Promise<string> {
    const badge = this.alertWarningBadge();
    if ((await badge.count()) === 0) return '';
    await badge.hover();
    return (await this.page.getByRole('tooltip').innerText()).trim();
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
   * Click Apply in the open Display Settings drawer and wait for it to close.
   */
  async applyDisplaySettings() {
    const drawer = this.page.getByRole('dialog', { name: 'Display Settings' });
    await drawer.getByRole('button', { name: 'Apply', exact: true }).click();
    await drawer.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Set the "Series Limit" value in the Display Settings drawer. On pie/bar
   * builder charts this caps the number of slices/bars displayed. Opens the
   * drawer, fills the input, then applies and closes.
   */
  async setSeriesLimit(limit: number) {
    await this.openDisplaySettings();
    const drawer = this.page.getByRole('dialog', { name: 'Display Settings' });
    await drawer.getByLabel('Series Limit').fill(String(limit));
    await this.applyDisplaySettings();
  }

  /**
   * Set the "Legend template" value in the Display Settings drawer (PromQL
   * charts only). Opens the drawer, fills the input, then applies and closes.
   */
  async setLegendTemplate(template: string) {
    await this.openDisplaySettings();
    const drawer = this.page.getByRole('dialog', { name: 'Display Settings' });
    await drawer.getByTestId('legend-template-input').fill(template);
    await this.applyDisplaySettings();
  }

  /**
   * Open the Display Settings drawer and wait for it to become visible.
   */
  async openDisplaySettings() {
    await this.page
      .getByRole('button', { name: 'Display Settings', exact: true })
      .click();
    const drawer = this.page.getByRole('dialog', { name: 'Display Settings' });
    await drawer.waitFor({ state: 'visible', timeout: 5000 });
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
   * Select a metric by name on the series at zero-based `index`. Like
   * selectMetric, but disambiguates between the metric selectors of a
   * multi-series metric chart.
   */
  async selectMetricForSeries(
    index: number,
    metricName: string,
    metricValue?: string,
  ) {
    const selector = this.page.getByTestId('metric-name-selector').nth(index);
    await selector.waitFor({ state: 'visible', timeout: 5000 });
    await selector.click();
    await selector.fill(metricName);
    if (metricValue) {
      // Every series' select keeps its (hidden) option list mounted, so
      // scope to the visible one — the dropdown just opened for this series.
      const targetMetricOption = this.page
        .locator(`[data-combobox-option="true"][value="${metricValue}"]`)
        .filter({ visible: true });
      await targetMetricOption.waitFor({ state: 'visible', timeout: 5000 });
      await targetMetricOption.click({ timeout: 5000 });
    } else {
      await this.page.keyboard.press('Enter');
    }
  }

  /**
   * Click the "Add Formula" button (metric sources only) to append a formula
   * row, and fill its expression (and optional alias). Targets the last
   * formula row so multiple formulas can be added in sequence.
   */
  async addFormula(expression: string, alias?: string) {
    await this.page.getByTestId('add-formula-button').click();
    const expressionInput = this.page
      .getByTestId('formula-expression-input')
      .last();
    await expressionInput.fill(expression);
    if (alias !== undefined) {
      await this.page.getByTestId('formula-alias-input').last().fill(alias);
    }
    await expressionInput.blur();
  }

  /**
   * Read the inline validation error of the formula row at zero-based
   * `index`, or null when the expression is valid.
   */
  async getFormulaError(index: number): Promise<string | null> {
    const input = this.page.getByTestId('formula-expression-input').nth(index);
    // Mantine renders the error node as a sibling within the input wrapper.
    const wrapper = input.locator('..').locator('..');
    const error = wrapper.locator('.mantine-InputWrapper-error');
    if ((await error.count()) === 0) {
      return null;
    }
    return error.textContent();
  }

  /**
   * Toggle the "Show input series" switch (visible while a metric formula
   * exists) between formula-only and formula + operand series output.
   */
  async toggleShowInputSeries() {
    await this.page.getByRole('switch', { name: 'Show input series' }).click();
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
    const modalBody = this.page.locator('.mantine-Modal-body');
    const table = modalBody.locator('table').first();
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
    const modalBody = this.page.locator('.mantine-Modal-body');
    const table = modalBody.locator('table').first();
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
