// tests/search/search-functionality.spec.ts
import { expect, Page, test } from '@playwright/test';

import login from '../utils/loginHelper';
import {
  addFilter,
  getResultsCount,
  performSearch,
} from '../utils/searchHelper';
import { selectTimeRange, toggleLiveTail } from '../utils/timeHelper';

test.describe('Search Page Core Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Navigate to search page
    await page.goto('http://localhost:8080/search');
  });

  test('Test search page loads correctly', async ({ page }) => {
    // Verify key elements are visible
    const searchInput = page.locator('[data-testid="search-input"]');
    await expect(searchInput).toBeVisible();

    const timePickerInput = page.locator('[data-testid="time-picker-input"]');
    await expect(timePickerInput).toBeVisible();

    const searchButton = page.locator('[data-testid="search-button"]');
    await expect(searchButton).toBeVisible();

    // Verify table exists after page loads
    const searchTable = page.locator('[data-testid="search-table-container"]');
    await expect(searchTable).toBeVisible();
  });

  test('Test basic search functionality', async ({ page }) => {
    // Perform search
    await performSearch(page, '*');

    // Verify results are displayed
    const logRows = page.locator('[data-testid="log-row"]');
    await expect(logRows).toHaveCount(1);

    // Perform another search
    await performSearch(page, 'level:info');

    // Verify results are updated
    await expect(page.url()).toContain('q=level%3Ainfo');
  });

  test('Test time range selection', async ({ page }) => {
    // Select time range
    await selectTimeRange(page, 'Past 15m');

    // Verify time range is updated in the UI
    const timePickerInput = page.locator('[data-testid="time-picker-input"]');
    await expect(timePickerInput).toContainText('Past 15m');

    // Verify URL contains the time range
    await expect(page.url()).toContain('timeRange=Past%2015m');

    // Select another time range
    await selectTimeRange(page, 'Past 1h');

    // Verify time range is updated
    await expect(timePickerInput).toContainText('Past 1h');
    await expect(page.url()).toContain('timeRange=Past%201h');
  });

  test('Test search view toggle (Table/Chart)', async ({ page }) => {
    // Default should be table view
    const tableView = page.locator('[data-testid="search-table-container"]');
    await expect(tableView).toBeVisible();

    // Switch to chart view
    const chartViewButton = page.locator('[data-testid="chart-view-button"]');
    if ((await chartViewButton.count()) > 0) {
      await chartViewButton.click();

      // Verify chart view is active
      const chartView = page.locator('[data-testid="search-chart"]');
      await expect(chartView).toBeVisible();

      // Switch back to table view
      const tableViewButton = page.locator('[data-testid="table-view-button"]');
      await tableViewButton.click();

      // Verify table view is active again
      await expect(tableView).toBeVisible();
    }
  });

  test('Test adding and removing filters', async ({ page }) => {
    // Perform initial search
    await performSearch(page, '*');

    // Add a filter
    await addFilter(page, 'level', 'error');

    // Verify filter is applied
    const appliedFilter = page.locator('[data-testid="applied-filter"]');
    await expect(appliedFilter).toBeVisible();
    await expect(appliedFilter).toContainText('level:error');

    // Add another filter
    await addFilter(page, 'service', 'api');

    // Verify both filters are applied
    const appliedFilters = page.locator('[data-testid="applied-filter"]');
    await expect(appliedFilters).toHaveCount(2);

    // Remove first filter
    const removeFilterBtn = appliedFilters
      .first()
      .locator('[data-testid="remove-filter"]');
    await removeFilterBtn.click();

    // Verify one filter remains
    await expect(appliedFilters).toHaveCount(1);

    // Remove second filter
    const removeLastFilterBtn = appliedFilters.locator(
      '[data-testid="remove-filter"]',
    );
    await removeLastFilterBtn.click();

    // Verify no filters remain
    await expect(appliedFilters).toHaveCount(0);
  });

  test('Test live tail functionality', async ({ page }) => {
    // Enable live tail if not already active
    await toggleLiveTail(page, true);

    // Verify live tail is active
    const timePickerInput = page.locator('[data-testid="time-picker-input"]');
    await expect(timePickerInput).toHaveValue('Live Tail');
    await expect(page.url()).toContain('isLive=true');

    // Wait briefly to let some logs stream in
    await page.waitForTimeout(2000);

    // Disable live tail
    await toggleLiveTail(page, false);

    // Verify live tail is disabled
    await expect(page.url()).toContain('isLive=false');

    // Re-enable live tail
    const resumeLiveButton = page.locator(
      '[data-testid="resume-live-tail-button"]',
    );
    await resumeLiveButton.click();

    // Verify live tail is active again
    await expect(page.url()).toContain('isLive=true');
  });

  test('Test log row expansion', async ({ page }) => {
    // Perform search
    await performSearch(page, '*');

    // Wait for logs to load
    const logRows = page.locator('[data-testid="log-row"]');
    await expect(logRows).toHaveCount(1);

    // Click on expand button for first log row
    const expandButton = logRows
      .first()
      .locator('[data-testid="expand-log-button"]');

    // Only proceed if expand buttons exist
    if ((await expandButton.count()) > 0) {
      await expandButton.click();

      // Verify row is expanded
      const expandedContent = page.locator(
        '[data-testid="expanded-log-content"]',
      );
      await expect(expandedContent).toBeVisible();

      // Collapse the row
      await expandButton.click();

      // Verify row is collapsed
      await expect(expandedContent).not.toBeVisible();
    }
  });

  test('Test search query history', async ({ page }) => {
    // Perform searches
    await performSearch(page, 'level:error');
    await performSearch(page, 'level:info');

    // Click history button if available
    const historyButton = page.locator('[data-testid="search-history-button"]');

    if ((await historyButton.count()) > 0) {
      await historyButton.click();

      // Verify history dropdown is visible
      const historyDropdown = page.locator(
        '[data-testid="search-history-dropdown"]',
      );
      await expect(historyDropdown).toBeVisible();

      // Verify our searches are in history
      await expect(historyDropdown).toContainText('level:error');
      await expect(historyDropdown).toContainText('level:info');

      // Click a history item
      const historyItem = historyDropdown.locator('text=level:error').first();
      await historyItem.click();

      // Verify the search is applied
      const searchInput = page.locator('[data-testid="search-input"]');
      await expect(searchInput).toHaveValue('level:error');
    }
  });

  test('Test column customization', async ({ page }) => {
    // Perform search
    await performSearch(page, '*');

    // Click column settings button if available
    const columnButton = page.locator('[data-testid="column-settings-button"]');

    if ((await columnButton.count()) > 0) {
      await columnButton.click();

      // Verify column settings panel is visible
      const columnPanel = page.locator('[data-testid="column-settings-panel"]');
      await expect(columnPanel).toBeVisible();

      // Toggle a column off if possible
      const columnToggle = columnPanel
        .locator('[data-testid="column-toggle"]')
        .first();
      const initialState = await columnToggle.isChecked();
      await columnToggle.click();

      // Verify toggle changed
      await expect(columnToggle).toBeChecked({ checked: !initialState });

      // Apply changes
      const applyButton = page.locator('[data-testid="apply-columns-button"]');
      await applyButton.click();

      // Verify panel is closed
      await expect(columnPanel).not.toBeVisible();
    }
  });
});
