// tests/search/advanced-search.spec.ts
import { expect, Page, test } from '@playwright/test';

import login from '../utils/loginHelper';
import {
  addFilter,
  getResultsCount,
  performSearch,
} from '../utils/searchHelper';
import { selectTimeRange } from '../utils/timeHelper';

test.describe('Advanced Search Functionality', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
    // Navigate to search page
    await page.goto('http://localhost:8080/search');
  });

  test('Test basic search query', async ({ page }) => {
    // Perform a basic search
    await performSearch(page, 'level:error');

    // Verify results are displayed
    const logRows = page.locator('[data-testid="log-row"]');
    await expect(logRows).toHaveCount(1);

    // Verify URL contains search parameters
    await expect(page).toHaveURL(/.*q=level%3Aerror.*/);
  });

  test('Test combined search with multiple conditions', async ({ page }) => {
    // Perform a search with multiple conditions
    await performSearch(page, 'level:error AND service:api');

    // Verify results
    const logRows = page.locator('[data-testid="log-row"]');
    await expect(logRows).toHaveCount(1);

    // Check for both conditions in results
    const levelCells = logRows.first().locator('text=error');
    await expect(levelCells).toBeVisible();

    const serviceCells = logRows.first().locator('text=api');
    await expect(serviceCells).toBeVisible();
  });

  test('Test search with filters', async ({ page }) => {
    // Perform a search
    await performSearch(page, '*');

    // Add filter
    await addFilter(page, 'level', 'error');

    // Verify filter is applied
    const appliedFilter = page.locator('[data-testid="applied-filter"]');
    await expect(appliedFilter).toBeVisible();
    await expect(appliedFilter).toContainText('level:error');

    // Verify URL contains filter
    await expect(page).toHaveURL(/.*level%3Aerror.*/);

    // Remove filter
    const removeFilterBtn = appliedFilter.locator(
      '[data-testid="remove-filter"]',
    );
    await removeFilterBtn.click();

    // Verify filter is removed
    await expect(appliedFilter).not.toBeVisible();
  });

  test('Test search with time range', async ({ page }) => {
    // Select time range
    await selectTimeRange(page, 'Past 15m');

    // Perform search
    await performSearch(page, 'level:info');

    // Verify results
    const logRows = page.locator('[data-testid="log-row"]');
    await expect(logRows).toHaveCount(1);

    // Verify time range in URL
    await expect(page).toHaveURL(/.*timeRange=Past%2015m.*/);
  });

  test('Test SQL mode search', async ({ page }) => {
    // Switch to SQL mode
    const queryTypeSwitch = page.locator('[data-testid="query-type-switch"]');
    await queryTypeSwitch.click();

    // Verify SQL mode is active
    await expect(queryTypeSwitch).toHaveAttribute('aria-checked', 'true');

    // Enter SQL query
    const sqlInput = page.locator('[data-testid="sql-editor"]');
    await sqlInput.fill("SELECT * FROM logs WHERE level = 'error' LIMIT 100");

    // Execute query
    await sqlInput.press('Enter');

    // Verify results
    const logRows = page.locator('[data-testid="log-row"]');
    await expect(logRows).toHaveCount(1);
  });

  test('Test search with grouping', async ({ page }) => {
    // Navigate to search page with chart view
    await page.goto('http://localhost:8080/search?display=chart');

    // Add group by
    const groupByButton = page.locator('[data-testid="group-by-button"]');
    await groupByButton.click();

    const fieldOption = page.locator('text=service');
    await fieldOption.click();

    const applyButton = page.locator('[data-testid="apply-group-by"]');
    await applyButton.click();

    // Verify chart is displayed
    const chartElement = page.locator('[data-testid="search-chart"]');
    await expect(chartElement).toBeVisible();

    // Verify URL contains groupBy
    await expect(page).toHaveURL(/.*groupBy=service.*/);
  });

  test('Test saved searches', async ({ page }) => {
    // Perform a search
    await performSearch(page, 'level:error');

    // Save the search
    const saveButton = page.locator('[data-testid="save-search-button"]');
    await saveButton.click();

    // Enter search name
    const searchNameInput = page.locator(
      '[data-testid="save-search-name-input"]',
    );
    await searchNameInput.fill('Test Error Search');

    // Save
    const confirmButton = page.locator(
      '[data-testid="confirm-save-search-button"]',
    );
    await confirmButton.click();

    // Navigate to saved searches
    await page.goto('http://localhost:8080/saved-searches');

    // Verify saved search exists
    const savedSearch = page.locator('text=Test Error Search');
    await expect(savedSearch).toBeVisible();

    // Click on saved search
    await savedSearch.click();

    // Verify search query is loaded
    await expect(page).toHaveURL(/.*q=level%3Aerror.*/);
  });
});
