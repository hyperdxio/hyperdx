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
   * Open/expand a filter group
   */
  async openFilterGroup(filterName: string) {
    await this.getFilterGroup(filterName).click();
  }

  /**
   * Get checkbox for a specific filter value
   * @param valueName - e.g., 'info', 'error', 'debug'
   */
  getFilterCheckbox(valueName: string) {
    return this.page.getByTestId(`filter-checkbox-${valueName}`);
  }

  /**
   * Get checkbox input element
   */
  getFilterCheckboxInput(valueName: string) {
    return this.page.getByTestId(`filter-checkbox-input-${valueName}`);
  }

  /**
   * Apply/select a filter value
   */
  async applyFilter(valueName: string) {
    const checkbox = this.getFilterCheckbox(valueName);
    await checkbox.click();
  }

  /**
   * Exclude a filter value (invert the filter)
   */
  async excludeFilter(valueName: string) {
    const filterCheckbox = this.getFilterCheckbox(valueName);
    await filterCheckbox.hover();

    const excludeButton = this.page.getByTestId(`filter-exclude-${valueName}`);
    await excludeButton.first().click();
  }

  /**
   * Pin a filter value to persist it
   */
  async pinFilter(valueName: string) {
    const filterCheckbox = this.getFilterCheckbox(valueName);
    await filterCheckbox.hover();

    const pinButton = this.page.getByTestId(`filter-pin-${valueName}`);
    await pinButton.click();
  }

  /**
   * Clear/unselect a filter
   */
  async clearFilter(valueName: string) {
    const input = this.getFilterCheckboxInput(valueName);
    const checkbox = this.getFilterCheckbox(valueName);
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
  async isFilterExcluded(valueName: string): Promise<boolean> {
    const input = this.getFilterCheckboxInput(valueName);
    const indeterminate = await input.getAttribute('data-indeterminate');
    return indeterminate === 'true';
  }

  /**
   * Get all filter values for a specific filter group
   */
  getFilterValues(filterGroupName: string) {
    return this.page.getByTestId(`filter-checkbox-${filterGroupName}`);
  }
}
