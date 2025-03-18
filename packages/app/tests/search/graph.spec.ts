// tests/search/graph.spec.ts
import { expect, test } from '@playwright/test';
import { Page } from '@playwright/test';

import login from '../utils/loginHelper';

import { disableLiveTail } from './utils/search-helpers';

test.describe.serial('Results graph functionality', () => {
  async function setupGraphTest(page: Page) {
    const graphBars = page.locator('.recharts-rectangle');
    await graphBars.first().click();
    await page.locator('.bg-grey').first().click();
    return graphBars;
  }

  test('should display graph with data', async ({ page }) => {
    await login(page);
    await page.waitForURL('**/search?isLive=true*');
    await disableLiveTail(page);

    const graphBars = page.locator('.recharts-rectangle');
    await expect(graphBars.first()).toBeVisible();

    const barCount = await graphBars.count();
    expect(barCount).toBeGreaterThan(0);

    const hasData = await graphBars.evaluateAll((elements: (SVGElement | HTMLElement)[]) => {
      return elements.some((el) => {
        const height = parseFloat(el.getAttribute('height') ?? '0');
        return height > 0;
      });
    });
    expect(hasData).toBe(true);
  });

  test('should handle graph bar click interaction', async ({ page }) => {
    await login(page);
    await page.waitForURL('**/search?isLive=true*');
    await disableLiveTail(page);
    
    await setupGraphTest(page);
    await page.waitForURL('**/search?*from=*&*to=*');

    const url = new URL(page.url());
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');
    const fromTime = new Date(parseInt(from ?? '0'));
    const toTime = new Date(parseInt(to ?? '0'));
    const timeDiff = toTime.getTime() - fromTime.getTime();
    expect(timeDiff).toEqual(15000);
  });

  test('should display results after graph interaction', async ({ page }) => {
    await login(page);
    await page.waitForURL('**/search?isLive=true*');
    await disableLiveTail(page);
    
    await setupGraphTest(page);

    const resultsTable = page.locator('[data-testid="search-table-container"]');
    await expect(resultsTable).toBeVisible();
    const resultsTableRow = resultsTable.locator('tr').first();
    await expect(resultsTableRow).toBeVisible();

    const graphBars2 = page.locator('.recharts-rectangle');
    await expect(graphBars2.first()).toBeVisible();
  });
});