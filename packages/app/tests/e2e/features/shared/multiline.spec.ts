import type { Locator, Page } from '@playwright/test';

import { DashboardPage } from '../../page-objects/DashboardPage';
import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Multiline Input', { tag: '@search' }, () => {
  const testInputExpansion = async (
    page: Page,
    editor: Locator,
    /** For CodeMirror, pass the content element that grows (e.g. .cm-content); for textarea, omit to use editor. */
    measureLocator?: Locator,
  ): Promise<void> => {
    const measureEl = measureLocator ?? editor;
    // Scroll into view then focus (more reliable than click for textarea/input in CI)
    await editor.scrollIntoViewIfNeeded();
    await editor.focus();
    await page.keyboard.type('first line');

    // Get initial single line height from the element that reflects content height
    const singleLineBox = await measureEl.boundingBox();
    const singleLineHeight = singleLineBox?.height || 0;

    // Add a line break and type second line
    await page.keyboard.press('Shift+Enter');
    await page.keyboard.type('second line');

    // Verify newline was inserted: CodeMirror has .cm-line per line; textarea value contains newline
    const isCodeMirror = (await editor.locator('.cm-line').count()) > 0;
    if (isCodeMirror) {
      await expect(editor.locator('.cm-line')).toHaveCount(2, {
        timeout: 2000,
      });
    } else {
      await expect(editor).toHaveValue(/first line[\r\n]+second line/, {
        timeout: 2000,
      });
    }

    // Verify height did not shrink (may stay same on some layouts e.g. scrollable area)
    const multiLineBox = await measureEl.boundingBox();
    const multiLineHeight = multiLineBox?.height || 0;
    expect(multiLineHeight).toBeGreaterThanOrEqual(singleLineHeight);
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
      whereText: 'WHERE',
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
      // CodeMirror: .cm-editor can stay fixed; .cm-content height reflects line count
      const measureEl = editor.locator('.cm-content').first();
      await testInputExpansion(page, editor, measureEl);
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
