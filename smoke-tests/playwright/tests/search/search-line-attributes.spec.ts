// tests/search/attribute-interactions.spec.ts
import { expect, test } from '@playwright/test';

import login from '../utils/loginHelper';

import {
  addToResultsTable,
  assertColumnBoxChanged,
  clickFirstSearchResult,
  propertyInteractions,
  searchForLinesWithLogAttributes,
} from './utils/search-helpers';

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
    page.waitForNavigation(),
  ]);

  await clickFirstSearchResult(page);
  await propertyInteractions(page);
  await addToResultsTable(page);
  await assertColumnBoxChanged(page, initialContent);

  await clickFirstSearchResult(page);
  await propertyInteractions(page);

  await Promise.all([
    page.click('[title="Add to Filters"]'),
    page.waitForNavigation(),
  ]);

  await page.click('[class*="SearchPage_filtersPanel"]');
  const filterCheckbox = page.locator(
    '[class*="SearchPage_filterCheckbox"] input[type="checkbox"]:checked',
  );
  await expect(filterCheckbox).toBeVisible();
  await expect(filterCheckbox).toHaveCount(1);
});
