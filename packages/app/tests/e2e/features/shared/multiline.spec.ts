import type { Locator, Page } from '@playwright/test';

import { DashboardPage } from '../../page-objects/DashboardPage';
import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Multiline Input', { tag: '@search' }, () => {
  const testInputExpansion = async (
    page: Page,
    editor: Locator,
  ): Promise<void> => {
    // Scroll into view then focus (more reliable than click for textarea/input in CI)
    await editor.scrollIntoViewIfNeeded();
    await editor.focus();
    await page.keyboard.type('first line');

    // Get initial single line height
    const singleLineBox = await editor.boundingBox();
    const singleLineHeight = singleLineBox?.height || 0;

    // Add a line break and type second line
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second line');

    // Verify height increased (poll for autosize to run in CI)
    await expect(async () => {
      const multiLineBox = await editor.boundingBox();
      const multiLineHeight = multiLineBox?.height || 0;
      expect(multiLineHeight).toBeGreaterThan(singleLineHeight);
    }).toPass({ timeout: 2000 });
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
    // Target the textarea so the click hits the typing area, not the Query language Select in the right section
    return page
      .locator('[data-testid="search-input"] textarea')
      .or(page.locator('textarea[data-testid="search-input"]'))
      .first();
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
        // Dashboard uses Controller + SQL/SearchInputV2 directly (no where-language-switch wrapper)
        await page.getByRole('textbox', { name: 'Query language' }).click();
        await page.getByRole('option', { name: 'SQL', exact: true }).click();
        // Wait for dropdown to close so the WHERE input is not covered
        await page
          .getByRole('option', { name: 'SQL', exact: true })
          .waitFor({ state: 'hidden', timeout: 5000 });
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
        // Dashboard has no where-language-switch wrapper; use Query language textbox directly
        await page.getByRole('textbox', { name: 'Query language' }).click();
        await page.getByRole('option', { name: 'Lucene', exact: true }).click();
        // Wait for dropdown to close so the search input is not covered
        await page
          .getByRole('option', { name: 'Lucene', exact: true })
          .waitFor({ state: 'hidden', timeout: 5000 });
      }

      const editor = getEditor(page, 'Lucene', formSelector, whereText);
      await expect(editor).toBeVisible();
      await testInputExpansion(page, editor);
    });
  });
});
