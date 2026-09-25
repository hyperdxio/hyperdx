/**
 * TableComponent - Reusable component for interacting with data tables
 * Used across Search, Logs, Traces, and other pages that display tabular data
 */
import { Locator, Page } from '@playwright/test';

export class TableComponent {
  readonly page: Page;
  private readonly tableContainer: Locator;

  constructor(page: Page, containerSelector = '[data-testid="results-table"]') {
    this.page = page;
    this.tableContainer = page.locator(containerSelector);
  }

  /**
   * Get all table rows
   * Usage in spec: await expect(table.getRows()).toHaveCount(10)
   */
  getRows() {
    return this.page.locator('[data-testid^="table-row-"]');
  }

  /**
   * Wait for at least one row to populate
   */
  async waitForRowsToPopulate(allowEmpty: boolean = false) {
    if (allowEmpty) {
      await this.tableContainer.waitFor({ state: 'visible', timeout: 5000 });
    } else {
      await this.firstRow.waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  /**
   * Get specific row by index (0-based)
   */
  getRow(index: number) {
    return this.getRows().nth(index);
  }

  /**
   * Get first row
   */
  get firstRow() {
    return this.getRows().first();
  }

  /**
   * Get last row
   */
  get lastRow() {
    return this.getRows().last();
  }

  /**
   * Click on a specific row
   */
  async clickRow(index: number) {
    await this.getRow(index).click();
  }

  /**
   * Click on the first row
   */
  async clickFirstRow() {
    await this.firstRow.click();
  }

  /**
   * Expand a row in place via its chevron button, revealing the inline expanded
   * row underneath it.
   */
  async expandRow(index: number) {
    await this.getRow(index)
      .getByRole('button', { name: 'Expand log details' })
      .click();
    await this.firstExpandedRow.waitFor({ state: 'visible', timeout: 10_000 });
  }

  /**
   * Collapse a row expanded by {@link expandRow}, via the same chevron.
   */
  async collapseRow(index: number) {
    await this.getRow(index)
      .getByRole('button', { name: 'Collapse log details' })
      .click();
  }

  /**
   * Scroll the virtualized container to an absolute offset.
   */
  async scrollTo(top: number) {
    await this.tableContainer.evaluate(
      (el, offset) => el.scrollTo({ top: offset }),
      top,
    );
  }

  /**
   * Layout readings for the virtualized scroll container.
   *
   * `visibleGapPx` is the empty space between the bottom of the last rendered
   * row and the bottom of the viewport. While rows remain below, a healthy
   * table overfills the viewport and this is negative; it turns positive when
   * the virtualizer holds stale row heights and stops rendering enough rows to
   * cover the screen.
   */
  async getVirtualizationMetrics() {
    return this.tableContainer.evaluate(el => {
      const rows = el.querySelectorAll('[data-testid^="table-row-"]');
      const last = rows[rows.length - 1];
      return {
        renderedRows: rows.length,
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        visibleGapPx: Math.round(
          el.getBoundingClientRect().bottom -
            (last ? last.getBoundingClientRect().bottom : 0),
        ),
        remainingBelowPx: Math.round(
          el.scrollHeight - el.scrollTop - el.clientHeight,
        ),
      };
    });
  }

  /**
   * All inline expanded rows currently rendered. Each carries
   * `data-testid="expanded-row-<rowWhere>"`, where rowWhere is a SQL fragment,
   * so match on the prefix rather than the full id.
   */
  get expandedRows() {
    return this.page.locator('[data-testid^="expanded-row-"]');
  }

  get firstExpandedRow() {
    return this.expandedRows.first();
  }

  /**
   * The row-level error state rendered inside the first expanded row when its
   * full row data query fails.
   */
  get expandedRowErrorState() {
    return this.firstExpandedRow.getByTestId('row-error-state');
  }

  /**
   * The "Known Columns List" hint rendered inside the first expanded row's error
   * state (a `SELECT *` failure against a Distributed/Merge table).
   */
  get expandedRowKnownColumnsListHint() {
    return this.firstExpandedRow.getByTestId('known-columns-list-hint');
  }

  /**
   * Switch the first expanded row between its Overview and Column Values tabs.
   */
  async openExpandedRowTab(tab: 'overview' | 'columnValues') {
    await this.firstExpandedRow
      .getByTestId(`tab-${tab.toLowerCase()}`)
      .click({ timeout: 10_000 });
  }

  /**
   * The Overview tab's body paper, its loading placeholder (rendered while the
   * full row query is in flight), and the empty-body copy (rendered only once
   * the query settles with no body).
   */
  get expandedRowBody() {
    return this.firstExpandedRow.getByTestId('side-panel-body');
  }

  get expandedRowBodyLoading() {
    return this.firstExpandedRow.getByTestId('side-panel-body-loading');
  }

  get expandedRowEmptyBody() {
    return this.firstExpandedRow.getByText('No body for this event.');
  }

  /**
   * Get cell value by row index and column name
   * Usage in spec: await expect(table.getCell(0, 'status')).toHaveText('200')
   */
  getCell(row: number, column: string) {
    return this.getRow(row).locator(`[data-column="${column}"]`);
  }

  /**
   * The multi-select checkbox of a row. Only rendered where row selection is
   * enabled (the search results table).
   */
  getRowCheckbox(index: number) {
    return this.getRow(index).getByTestId('row-select-checkbox');
  }

  /**
   * The cell holding a row's multi-select checkbox. It is the element that
   * fades the checkbox in and out, so assert visibility on it rather than on
   * the checkbox itself.
   */
  getRowCheckboxCell(index: number) {
    return this.getRow(index).getByTestId('row-select-cell');
  }

  async hoverRow(index: number) {
    await this.getRow(index).hover();
  }

  /**
   * Select multiple rows by indices
   */
  async selectRows(indices: number[]) {
    for (const index of indices) {
      await this.getRowCheckbox(index).click();
    }
  }

  /**
   * Extend the selection from the last clicked row to this one.
   */
  async shiftSelectRow(index: number) {
    await this.getRowCheckbox(index).click({ modifiers: ['Shift'] });
  }

  async getSelectedRowCount() {
    return this.getRows().locator('input:checked').count();
  }

  /**
   * Get the table container for visibility checks
   */
  get container() {
    return this.tableContainer;
  }

  /**
   * Get header by column name
   */
  getHeader(columnName: string) {
    return this.page.locator(`[data-testid="table-header-${columnName}"]`);
  }

  /**
   * Sort by column (if sortable)
   */
  async sortByColumn(columnName: string) {
    await this.getHeader(columnName).click();
  }
}
