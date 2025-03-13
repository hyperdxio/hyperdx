import { expect, Page,test } from '@playwright/test';

import login from '../utils/loginHelper';
async function propertyInteractions(page: Page) {
  const LogElement = page.locator('[class*="HyperJson_valueContainer__"]').nth(1);
  await expect(LogElement).toBeVisible();
  await LogElement.hover();
}

async function clickFirstSearchResult(page: Page) {
  const element = page.locator('tr[data-index="0"]');
  await expect(element).toBeVisible();
  await element.click();
}

async function addToResultsTable(page: Page) {
  await page.click('[title*="column to results table"]');
  await page.click('[class*="SearchPage_filtersPanel"]');
}

async function assertColumnBoxChanged(page: Page, initialContent: string | null) {
  const columnBox = page.locator('.cm-line').first();
  const newContent = await columnBox.textContent();
  await expect(columnBox).toBeVisible();
  await expect(newContent).not.toBe(initialContent);
}

async function searchForLinesWithLogAttributes(page: Page) {
  await page.waitForURL('**/search?isLive=true*source=*');
  const url = new URL(page.url());

  // Update specific query parameters
  url.searchParams.set('where', 'notEmpty(LogAttributes)');
  url.searchParams.set('select', 'Timestamp, ServiceName, SeverityText, Body, LogAttributes');
  url.searchParams.set('whereLanguage', 'sql');

  // Navigate to the modified URL
  await page.goto(url.toString());
}

test('Test Search Result Attribute Interactions', async ({ page }) => {
  await login(page);
  await searchForLinesWithLogAttributes(page);
  await page.setViewportSize({ width: 2528, height: 1209 });

  const columnBox = page.locator('.cm-line').first();
  const initialContent = await columnBox.textContent();

  await clickFirstSearchResult(page);

  const sidePanel = page.locator('[class*="LogSidePanel_panel"]').first();
  await expect(sidePanel).toBeVisible();

  await propertyInteractions(page);

  await Promise.all([
    page.click('[title="Search for this value only"]'),
    page.waitForNavigation()
  ]);

  await clickFirstSearchResult(page);

  await propertyInteractions(page);

  await addToResultsTable(page);
  await assertColumnBoxChanged(page, initialContent);

  await clickFirstSearchResult(page);

  await propertyInteractions(page);

  await Promise.all([
    page.click('[title="Add to Filters"]'),
    page.waitForNavigation()
  ]);

  await page.click('[class*="SearchPage_filtersPanel"]');
  const filterCheckbox = page.locator('[class*="SearchPage_filterCheckbox"] input[type="checkbox"]:checked');
  await expect(filterCheckbox).toBeVisible();
  await expect(filterCheckbox).toHaveCount(1);
});

test('Test live search', async ({ page }) => {
  await login(page);
  await page.waitForURL('**/search?isLive=true*');

  // Scroll down in the table to trigger live tail off
  const tableContainer = page.locator('[data-testid="search-table-container"]');
  await expect(tableContainer).toBeVisible();
  await tableContainer.evaluate((container) => {
    setTimeout(() => {
      container.scrollTop += 200;
    }, 100);
    
  });

  //Check URL is updated to live=false  
  await page.waitForURL('**/search?isLive=false*');

  //Click resume live tail button
  await page.click('[data-testid="resume-live-tail-button"]');

  //Check URL is updated to live=true
  await page.waitForURL('**/search?isLive=true*');

  //Check time picker input is updated to live tail
  const timePickerInput = page.locator('[data-testid="time-picker-input"]');
  await expect(timePickerInput).toHaveValue('Live Tail');
});
