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
   * Get cell value by row index and column name
   * Usage in spec: await expect(table.getCell(0, 'status')).toHaveText('200')
   */
  getCell(row: number, column: string) {
    return this.getRow(row).locator(`[data-column="${column}"]`);
  }

  /**
   * Select multiple rows by indices
   */
  async selectRows(indices: number[]) {
    for (const index of indices) {
      await this.getRow(index).locator('[type="checkbox"]').check();
    }
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
