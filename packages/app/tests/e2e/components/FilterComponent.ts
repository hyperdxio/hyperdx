/**
 * FilterComponent - Reusable component for search filters
 * Used for applying, excluding, pinning, and searching filters
 */
import { Locator, Page } from '@playwright/test';

export class FilterComponent {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  private async scrollAndClick(locator: Locator, testId: string) {
    // Filters live in a side nav with its own ScrollArea. Use native scrollIntoView
    // so the browser scrolls within that container; Playwright's scrollIntoViewIfNeeded
    // can be unreliable with nested scroll containers.
    await locator.evaluate(el =>
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' }),
    );
    await locator.hover();

    // The action buttons live in a CSS-hover-revealed overlay (display:none → flex).
    // Use dispatchEvent so we don't depend on the hover state still being active
    // at the moment Playwright attempts the click.
    const button = locator.getByTestId(testId);
    await button.waitFor({ state: 'attached' });
    await button.dispatchEvent('click');
  }

  /**
   * Get filter group by name
   * @param filterName - e.g., 'SeverityText', 'ServiceName'
   */
  getFilterGroup(filterName: string) {
    return this.page.getByTestId(`filter-group-${filterName}`);
  }

  /**
   * Get filter group control (clickable header)
   */
  getFilterGroupControl(index?: number) {
    const controls = this.page.getByTestId('filter-group-control');
    return index !== undefined ? controls.nth(index) : controls;
  }

  /**
   * Open/expand a filter group (toggles — may close if already open)
   */
  async openFilterGroup(filterName: string) {
    await this.getFilterGroup(filterName).click();
  }

  /**
   * Get checkbox for a specific filter value within a column
   * @param columnName - e.g., 'ServiceName', 'SeverityText'
   * @param valueName - e.g., 'info', 'error', 'debug'
   */
  getFilterCheckbox(columnName: string, valueName: string) {
    return this.page.getByTestId(`filter-checkbox-${columnName}-${valueName}`);
  }

  /**
   * Get checkbox input element within a column
   */
  getFilterCheckboxInput(columnName: string, valueName: string) {
    return this.page.getByTestId(
      `filter-checkbox-${columnName}-${valueName}-input`,
    );
  }

  /**
   * Apply/select a filter value
   */
  async applyFilter(columnName: string, valueName: string) {
    const checkbox = this.getFilterCheckbox(columnName, valueName);
    await checkbox.click();
  }

  /**
   * Exclude a filter value (invert the filter)
   */
  async excludeFilter(columnName: string, valueName: string) {
    const filterCheckbox = this.getFilterCheckbox(columnName, valueName);
    await this.scrollAndClick(
      filterCheckbox,
      `filter-checkbox-${columnName}-${valueName}-exclude`,
    );
  }

  /**
   * Pin a filter value to persist it
   */
  async pinFilter(columnName: string, valueName: string) {
    const filterCheckbox = this.getFilterCheckbox(columnName, valueName);
    await this.scrollAndClick(
      filterCheckbox,
      `filter-checkbox-${columnName}-${valueName}-pin`,
    );
  }

  /**
   * Clear/unselect a filter
   */
  async clearFilter(columnName: string, valueName: string) {
    const input = this.getFilterCheckboxInput(columnName, valueName);
    const checkbox = this.getFilterCheckbox(columnName, valueName);
    await checkbox.click();
    await input.click();
  }

  /**
   * Get filter search input
   */
  getFilterSearchInput(filterName: string) {
    return this.page.getByTestId(`filter-search-${filterName}`);
  }

  /**
   * Search within a filter's values
   */
  async searchFilterValues(filterName: string, searchText: string) {
    const searchInput = this.getFilterSearchInput(filterName);
    await searchInput.fill(searchText);
  }

  /**
   * Clear filter search
   */
  async clearFilterSearch(filterName: string) {
    const searchInput = this.getFilterSearchInput(filterName);
    await searchInput.clear();
  }

  /**
   * Find and expand first filter group that has a search input (>5 values)
   * Returns the filter name if found, null otherwise
   */
  async findFilterWithSearch(skipNames: string[] = []): Promise<string | null> {
    const filterControls = this.getFilterGroupControl();
    const count = await filterControls.count();

    for (let i = 0; i < Math.min(count, 5); i++) {
      const filter = filterControls.nth(i);
      const filterText = (await filter.textContent()) || '';
      const filterName = filterText.trim().replace(/\s*\(\d+\)\s*$/, '');

      // Skip filters in the skip list
      if (skipNames.some(skip => filterName.toLowerCase().includes(skip))) {
        continue;
      }

      // Expand the filter
      await filter.click();

      // Check if search input appears
      const searchInput = this.getFilterSearchInput(filterName);

      try {
        await searchInput.waitFor({ state: 'visible', timeout: 1000 });
        // Search input is visible, return this filter name
        return filterName;
      } catch (e) {
        // Search input not visible, collapse and try next
        await filter.click();
      }
    }

    return null;
  }

  /**
   * Check if filter checkbox is indeterminate (excluded state)
   */
  async isFilterExcluded(
    columnName: string,
    valueName: string,
  ): Promise<boolean> {
    const input = this.getFilterCheckboxInput(columnName, valueName);
    const indeterminate = await input.getAttribute('data-indeterminate');
    return indeterminate === 'true';
  }

  /**
   * Get all filter values for a specific filter group
   */
  getFilterValues(filterGroupName: string) {
    return this.page.getByTestId(
      new RegExp(`^filter-checkbox-${filterGroupName}-`),
    );
  }

  /**
   * Click "Load more" or "Show more" for a filter group if visible, so that
   * all options (or more options) are shown. Use when pickVisibleFilterValues
   * might otherwise only see a limited initial set.
   */
  async ensureFilterOptionsExpanded(filterGroupName: string): Promise<void> {
    const group = this.getFilterGroup(filterGroupName);
    const loadMore = this.page.getByTestId(
      `filter-load-more-${filterGroupName}`,
    );
    const showMore = this.page.getByTestId(
      `filter-show-more-${filterGroupName}`,
    );

    if (await loadMore.isVisible()) {
      await loadMore.click();
      await group
        .getByText('Loading more...')
        .waitFor({ state: 'hidden', timeout: 15000 })
        .catch(() => {});
    }

    if (await showMore.isVisible()) {
      const text = (await showMore.textContent()) ?? '';
      if (text.includes('Show more')) {
        await showMore.click();
      }
    }
  }

  /**
   * Open a filter group and return the first N filter values from the candidate
   * list that are visible in the UI. Use seed constants (e.g. SEVERITIES) as
   * candidates so tests don't rely on a single value that may not be present.
   * Expands "Load more" / "Show more" if needed so hidden options are visible.
   * @param filterGroupName - e.g. 'SeverityText', 'ServiceName'
   * @param candidates - possible values from seed (e.g. SEVERITIES from seed-clickhouse)
   * @param count - number of visible values to return (default 2)
   * @returns array of up to `count` values that are visible
   */
  async pickVisibleFilterValues(
    filterGroupName: string,
    candidates: readonly string[],
    count: number = 2,
  ): Promise<string[]> {
    await this.openFilterGroup(filterGroupName);

    // Wait for initial facet options to load
    const group = this.getFilterGroup(filterGroupName);
    await group
      .locator(
        `[data-testid^="filter-checkbox-${filterGroupName}-"][data-testid$="-input"]`,
      )
      .first()
      .waitFor({ state: 'visible', timeout: 10000 });

    await this.ensureFilterOptionsExpanded(filterGroupName);

    const visible: string[] = [];
    for (const value of candidates) {
      if (visible.length >= count) break;
      const input = this.getFilterCheckboxInput(filterGroupName, value);
      if (await input.isVisible()) visible.push(value);
    }
    if (visible.length < count) {
      throw new Error(
        `pickVisibleFilterValues: expected at least ${count} visible values in ${filterGroupName} from [${candidates.join(', ')}], got ${visible.length}`,
      );
    }
    return visible;
  }

  // ---- Shared Filters ----

  /**
   * Get the shared filters section container
   */
  getSharedFiltersSection() {
    return this.page.getByTestId('shared-filters-section');
  }

  /**
   * Check if the shared filters section is visible
   */
  async isSharedFiltersSectionVisible(): Promise<boolean> {
    return this.getSharedFiltersSection()
      .isVisible()
      .catch(() => false);
  }

  /**
   * Pin a field (group-level pin, not a value pin).
   * Opens the PinShareMenu on the filter group header and clicks "Pin for me".
   */
  async pinField(filterName: string) {
    const group = this.getFilterGroup(filterName);
    await group.hover();
    // The pin button is the PinShareMenu trigger inside the filter group header
    const pinButton = group.locator('button[aria-label="Pin"]').first();
    await pinButton.click();
    // Click "Pin for me" in the dropdown menu
    await this.page.getByRole('menuitem', { name: 'Pin for me' }).click();
  }

  /**
   * Share a field with the team via the PinShareMenu dropdown.
   */
  async shareFieldWithTeam(filterName: string) {
    const group = this.getFilterGroup(filterName);
    await group.hover();
    const pinButton = group.locator('button[aria-label="Pin"]').first();
    await pinButton.click();
    await this.page.getByRole('menuitem', { name: 'Share with team' }).click();
  }

  /**
   * Unshare a field from the team via the PinShareMenu dropdown.
   * Looks in the Shared Filters section since shared fields are moved there.
   */
  async unshareField(filterName: string) {
    // Shared fields live in the Shared Filters section, not the regular list
    const sharedSection = this.getSharedFiltersSection();
    const group = sharedSection.getByTestId(
      `shared-filter-group-${filterName}`,
    );
    await group.hover();
    const pinButton = group
      .locator('button[aria-label="Unpin"], button[aria-label="Pin"]')
      .first();
    await pinButton.click();
    await this.page
      .getByRole('menuitem', { name: 'Remove from Shared' })
      .click();
  }
}
