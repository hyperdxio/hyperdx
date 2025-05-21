import { expect, Page } from '@playwright/test';

/**
 * Perform a search with the given query and optional source selection
 */
export async function performSearch(
  page: Page,
  query: string,
  source?: string,
) {
  const searchInput = page.locator('[data-testid="search-input"]');
  await expect(searchInput).toBeVisible();
  await searchInput.fill(query);

  if (source) {
    const sourceSelect = page.locator('[data-testid="search-source-select"]');
    await sourceSelect.click();
    await page.getByRole('option', { name: source }).click();
  }

  await searchInput.press('Enter');
  await page.waitForURL('**/search?*q=*');
}

/**
 * Add a filter with field and value
 */
export async function addFilter(page: Page, field: string, value: string) {
  const filterButton = page.locator('[data-testid="add-filter-button"]');
  await filterButton.click();

  const fieldOption = page.locator(`text=${field}`);
  await fieldOption.click();

  const filterValueInput = page.locator('[data-testid="filter-value-input"]');
  await filterValueInput.fill(value);

  const applyButton = page.locator('[data-testid="apply-filter-button"]');
  await applyButton.click();
}

/**
 * Get the count of search results
 */
export async function getResultsCount(page: Page): Promise<number> {
  const totalCount = page.locator('[data-testid="search-total-count"]');
  await expect(totalCount).toBeVisible();

  const text = await totalCount.innerText();
  const match = text.match(/^(\d+)\s+Results$/);
  if (!match) throw new Error('Could not parse results count');

  return parseInt(match[1], 10);
}

/**
 * Toggle search between live and historical modes
 */
export async function toggleLiveSearch(page: Page, enableLive: boolean) {
  const currentUrl = page.url();
  const isCurrentlyLive = currentUrl.includes('isLive=true');

  if (enableLive && !isCurrentlyLive) {
    await page.click('[data-testid="resume-live-tail-button"]');
    await page.waitForURL('**/search?isLive=true*');
  } else if (!enableLive && isCurrentlyLive) {
    // Scroll the table to trigger switching out of live mode
    const tableContainer = page.locator(
      '[data-testid="search-table-container"]',
    );
    await tableContainer.evaluate((container: HTMLElement) => {
      container.scrollTop += 200;
    });
    await page.waitForURL('**/search?isLive=false*');
  }
}

/**
 * Open the log detail side panel for a specific log entry
 */
export async function openLogDetail(page: Page, rowIndex: number = 0) {
  const logRows = page.locator('[data-testid="log-row"]');
  await expect(logRows).toHaveCount(rowIndex + 1);
  await logRows.nth(rowIndex).click();

  const sidePanel = page.locator('[data-testid="log-detail-panel"]');
  await expect(sidePanel).toBeVisible();

  return sidePanel;
}

/**
 * Save the current search query
 */
export async function saveSearch(page: Page, name: string) {
  const saveButton = page.locator('[data-testid="save-search-button"]');
  await saveButton.click();

  const nameInput = page.locator('[data-testid="save-search-name-input"]');
  await nameInput.fill(name);

  const confirmButton = page.locator(
    '[data-testid="confirm-save-search-button"]',
  );
  await confirmButton.click();

  // Wait for confirmation toast or success indicator
}

/**
 * Select a time range from the time picker
 */
export async function selectTimeRange(page: Page, rangeText: string) {
  const timePicker = page.locator('[data-testid="time-picker-input"]');
  await timePicker.click();

  const timeOption = page.getByRole('option', { name: rangeText });
  await timeOption.click();

  // Wait for URL to update with the new time range or for the page to load with new data
  await page.waitForLoadState('networkidle');
}
