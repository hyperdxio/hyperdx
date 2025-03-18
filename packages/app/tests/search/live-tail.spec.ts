// tests/search/live-tail.spec.ts
import { expect, test } from '@playwright/test';

import login from '../utils/loginHelper';

test('Test live search', async ({ page }) => {
  await login(page);
  await page.waitForURL('**/search?isLive=true*');

  const tableContainer = page.locator('[data-testid="search-table-container"]');
  await expect(tableContainer).toBeVisible();
  await tableContainer.evaluate((container) => {
    setTimeout(() => {
      container.scrollTop += 200;
    }, 100);
  });

  await page.waitForURL('**/search?isLive=false*');
  await page.click('[data-testid="resume-live-tail-button"]');
  await page.waitForURL('**/search?isLive=true*');

  const timePickerInput = page.locator('[data-testid="time-picker-input"]');
  await expect(timePickerInput).toHaveValue('Live Tail');
});