/**
 * FilterChipsComponent — interactions for the inline filter chips rendered
 * inside the WHERE input on the search page.
 *
 * Chips are emitted by InlineFilterChips. Each chip element is tagged with:
 *   - data-testid="filter-chip"
 *   - data-field={field}, data-type={included|excluded|range}, data-value={value}
 * and contains a remove button with data-testid="filter-chip-remove".
 *
 * The group container has data-testid="filter-chips-group".
 */
import { Locator, Page } from '@playwright/test';

export type ChipType = 'included' | 'excluded' | 'range';

/**
 * Describes a single filter to seed via the URL. Used by buildFiltersUrl to
 * bypass the sidebar — important when multi-value tests would otherwise be
 * blocked by the sidebar facet collapsing to "only currently matching values"
 * after the first filter is applied.
 */
export type SeedFilter =
  | { field: string; values: string[]; mode: 'included' | 'excluded' }
  | { field: string; range: { min: number; max: number } };

/**
 * Encode the array of filters into a value matching DBSearchPage's URL state
 * encoding (parseAsJsonEncoded = encodeURIComponent(JSON.stringify(...))).
 */
export function buildFiltersUrlParam(filters: SeedFilter[]): string {
  const sqlFilters = filters.map(f => {
    if ('range' in f) {
      return {
        type: 'sql' as const,
        condition: `${f.field} BETWEEN ${f.range.min} AND ${f.range.max}`,
      };
    }
    const op = f.mode === 'excluded' ? 'NOT IN' : 'IN';
    const list = f.values.map(v => `'${v.replace(/'/g, "''")}'`).join(', ');
    return { type: 'sql' as const, condition: `${f.field} ${op} (${list})` };
  });
  return encodeURIComponent(JSON.stringify(sqlFilters));
}

export class FilterChipsComponent {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  /** Container for the chip group inside the input. */
  get group(): Locator {
    return this.page.getByTestId('filter-chips-group');
  }

  /** All chip elements currently rendered. */
  get chips(): Locator {
    return this.page.getByTestId('filter-chip');
  }

  /** Locate a chip by (field, value, type). */
  chip(field: string, value: string, type: ChipType = 'included'): Locator {
    return this.page.locator(
      `[data-testid="filter-chip"][data-field="${field}"][data-value="${value}"][data-type="${type}"]`,
    );
  }

  /** Remove button inside a specific chip. */
  remove(field: string, value: string, type: ChipType = 'included'): Locator {
    return this.chip(field, value, type).getByTestId('filter-chip-remove');
  }

  async getCount(): Promise<number> {
    return this.chips.count();
  }

  /** Read the displayed "<field> <op> <value>" text from a chip. */
  async readChipText(
    field: string,
    value: string,
    type: ChipType = 'included',
  ): Promise<string> {
    const chip = this.chip(field, value, type);
    const f = await chip.getByTestId('filter-chip-field').textContent();
    const op = await chip.getByTestId('filter-chip-operator').textContent();
    const v = await chip.getByTestId('filter-chip-value').textContent();
    return `${(f ?? '').trim()} ${(op ?? '').trim()} ${(v ?? '').trim()}`;
  }

  async clickRemove(
    field: string,
    value: string,
    type: ChipType = 'included',
  ): Promise<void> {
    await this.remove(field, value, type).click();
  }
}
