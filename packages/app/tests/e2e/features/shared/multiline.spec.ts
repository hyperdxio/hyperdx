import type { Locator, Page } from '@playwright/test';

import { DashboardPage } from '../../page-objects/DashboardPage';
import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Multiline Input', { tag: '@search' }, () => {
  const testInputExpansion = async (
    page: Page,
    editor: Locator,
  ): Promise<void> => {
    // Click and type first line
    await editor.click();
    await page.keyboard.type('first line');

    // Get initial single line height
    const singleLineBox = await editor.boundingBox();
    const singleLineHeight = singleLineBox?.height || 0;

    // Add a line break and type second line
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second line');

    // Verify height increased
    const multiLineBox = await editor.boundingBox();
    const multiLineHeight = multiLineBox?.height || 0;
    expect(multiLineHeight).toBeGreaterThan(singleLineHeight);
  };

  const getEditor = (
    page: Page,
    mode: 'SQL' | 'Lucene',
    formSelector?: string,
    whereText = 'WHERE',
  ): Locator => {
    if (mode === 'SQL') {
      const container = formSelector ? page.locator(formSelector) : page;
      const whereContainer = container.locator(
        `div:has(div.mantine-Text-root:has-text("${whereText}"))`,
      );
      return whereContainer.locator('.cm-editor').first();
    }
    return page.locator('[data-testid="search-input"]');
  };

  // Test configurations
  const tests = [
    {
      path: '/search',
      name: 'Search Page',
      formSelector: '[data-testid="search-form"]',
      whereText: 'WHERE',
    },
    {
      path: '/dashboards',
      name: 'Dashboard Page',
      formSelector: undefined,
      whereText: 'GLOBAL WHERE',
    },
  ];

  tests.forEach(({ path, name, formSelector, whereText }) => {
    test(`should expand SQL input on line break on ${name}`, async ({
      page,
    }) => {
      // Navigate using page object
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (path === '/search') {
        const searchPage = new SearchPage(page);
        await searchPage.goto();
        await searchPage.switchToSQLMode();
      } else {
        const dashboardPage = new DashboardPage(page);
        await dashboardPage.goto();
        // Switch to SQL mode
        const container = page;
        await container.locator('text=SQL').first().click();
      }

      const editor = getEditor(page, 'SQL', formSelector, whereText);
      await expect(editor).toBeVisible();
      await testInputExpansion(page, editor);
    });

    test(`should expand Lucene input on line break on ${name}`, async ({
      page,
    }) => {
      // Navigate using page object
      // eslint-disable-next-line playwright/no-conditional-in-test
      if (path === '/search') {
        const searchPage = new SearchPage(page);
        await searchPage.goto();
        await searchPage.switchToLuceneMode();
      } else {
        const dashboardPage = new DashboardPage(page);
        await dashboardPage.goto();
        // Switch to Lucene mode
        const container = page;
        await container.locator('text=Lucene').first().click();
      }

      const editor = getEditor(page, 'Lucene', formSelector, whereText);
      await expect(editor).toBeVisible();
      await testInputExpansion(page, editor);
    });
  });
});
