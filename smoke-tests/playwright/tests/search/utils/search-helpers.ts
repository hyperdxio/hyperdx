// tests/search/utils/search-helpers.ts
import { expect, Page } from '@playwright/test';

export async function propertyInteractions(page: Page) {
  const LogElement = page
    .locator('[class*="HyperJson_valueContainer__"]')
    .nth(1);
  await expect(LogElement).toBeVisible();
  await LogElement.hover();
}

export async function clickFirstSearchResult(page: Page) {
  const element = page.locator('tr[data-index="0"]');
  await expect(element).toBeVisible();
  await element.click();
}

export async function addToResultsTable(page: Page) {
  await page.click('[title*="column to results table"]');
  await page.click('[class*="SearchPage_filtersPanel"]');
}

export async function assertColumnBoxChanged(
  page: Page,
  initialContent: string | null,
) {
  const columnBox = page.locator('.cm-line').first();
  const newContent = await columnBox.textContent();
  await expect(columnBox).toBeVisible();
  await expect(newContent).not.toBe(initialContent);
}

export async function searchForLinesWithLogAttributes(page: Page) {
  await page.waitForURL('**/search?isLive=true*source=*');
  const url = new URL(page.url());
  url.searchParams.set('where', 'notEmpty(LogAttributes)');
  url.searchParams.set(
    'select',
    'Timestamp, ServiceName, SeverityText, Body, LogAttributes',
  );
  url.searchParams.set('whereLanguage', 'sql');
  await page.goto(url.toString());
}

export async function disableLiveTail(page: Page) {
  const url = new URL(page.url());
  url.searchParams.set('isLive', 'false');
  await page.goto(url.toString());
}
