import { expect, Page, test } from '@playwright/test';

import login from '../utils/loginHelper';

async function getInitialRowCount(page: Page) {
  const totalCount = page.locator('[data-testid="search-total-count"]');
  await expect(totalCount).toBeVisible();
  
  // Wait for a number to appear
  await expect
    .poll(async () => {
      const text = await totalCount.innerText();
      const match = text.match(/^(\d+)\s+Results$/);
      return match ? parseInt(match[1], 10) : null;
    }, {
      message: 'Waiting for results count to show a number',
      timeout: 2000,
    })
    .toBeTruthy();

  const text = await totalCount.innerText();
  const match = text.match(/^(\d+)\s+Results$/);
  if (!match) throw new Error('Could not parse results count');
  
  return parseInt(match[1], 10);
}

test('filters should update results table', async ({ page }) => {
  await login(page);
  
  await page.waitForURL('**/search*');
  
  // Click the input to open the custom dropdown
  await page.locator('[data-testid="search-source-select"]').click();

  // Select an option from the source dropdown
  await page.getByRole('option', { name: 'logs' }).click();
 
  // Wait for the URL to change to the new search URL
  await page.waitForURL('**/search?isLive=true*from=*to=*');
  
  // Get initial results count
  const resultsTable = page.locator('[data-testid="search-table-container"]');
  await expect(resultsTable).toBeVisible();
  
  // check the total count
  const initialRowCount = await getInitialRowCount(page);

  // Click first available filter value (any filter)
  const firstFilterValue = page.locator('[class*="SearchPage_filterCheckbox"]').first();
  await expect(firstFilterValue).toBeVisible();
  await firstFilterValue.click();

  // Verify URL contains filter parameter
  await page.waitForURL('**/search?*filters=*');
  const url = new URL(page.url());
  const filters = url.searchParams.get('filters');
  expect(filters).toBeTruthy();
  
  // Verify results table updates
  const filteredRowCount = await getInitialRowCount(page);
  expect(filteredRowCount).toBeLessThanOrEqual(initialRowCount);
  expect(filteredRowCount).toBeGreaterThan(0);
});