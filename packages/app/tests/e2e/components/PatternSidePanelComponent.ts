/**
 * PatternSidePanelComponent - the "Pattern" drawer opened from the Event
 * Patterns list. Wraps its "Sample Events" table so specs can assert on the
 * sample columns (e.g. that the Service column is populated).
 */
import { Locator, Page } from '@playwright/test';

// Column order rendered by the sample table (see PatternSidePanel's
// displayedColumns): Timestamp, Service, level, Body.
const SERVICE_COLUMN_INDEX = 1;

export class PatternSidePanelComponent {
  readonly page: Page;
  private readonly panelContainer: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panelContainer = page.getByTestId('pattern-side-panel');
  }

  get container() {
    return this.panelContainer;
  }

  /** The "Sample Events" table inside the drawer. */
  get sampleTable() {
    return this.panelContainer.getByTestId('search-results-table');
  }

  get sampleRows() {
    return this.panelContainer.locator('[data-testid^="table-row-"]');
  }

  get firstRow() {
    return this.sampleRows.first();
  }

  /** The "Service" column header of the sample table. */
  get serviceColumnHeader() {
    return this.panelContainer.getByRole('columnheader', { name: 'Service' });
  }

  /**
   * The Service-column cell of a sample row. Columns render as sibling divs
   * inside the row's content button, in the order declared by displayedColumns,
   * so the Service value is at a fixed position.
   */
  serviceCell(rowIndex = 0) {
    return this.sampleRows
      .nth(rowIndex)
      .locator('td > button > div')
      .nth(SERVICE_COLUMN_INDEX);
  }
}
