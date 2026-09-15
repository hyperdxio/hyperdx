import { DashboardsListPage } from 'tests/e2e/page-objects/DashboardsListPage';
import type { Locator, Page } from '@playwright/test';

import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Multiline Input', { tag: '@search' }, () => {
  const testInputExpansion = async (
    page: Page,
    editor: Locator,
    /** The WHERE input as a whole, when its addon seam also needs checking. */
    seamRow?: Locator,
    {
      growthLocator,
      visibleBoxLocator,
    }: {
      /** For CodeMirror, the content element that grows (e.g. .cm-content); defaults to the editor. */
      growthLocator?: Locator;
      /** The bordered box the user actually sees; defaults to the editor. */
      visibleBoxLocator?: Locator;
    } = {},
  ): Promise<void> => {
    const measureEl = growthLocator ?? editor;
    const visibleBox = visibleBoxLocator ?? editor;
    // Scroll into view then focus (more reliable than click for textarea/input in CI)
    await editor.scrollIntoViewIfNeeded();
    await editor.focus();
    await page.keyboard.type('first line');

    // One short line puts the input at its minimum height, which is the only
    // state where a row reserving more space than its bordered box shows up.
    // An empty input is no good for this: the placeholder wraps at narrow
    // widths and the content then drives the height.
    if (seamRow != null) {
      await expectSeamFlush(seamRow);
    }

    // Get initial single line height from the element that reflects content height
    const singleLineBox = await measureEl.boundingBox();
    const singleLineHeight = singleLineBox?.height || 0;
    const singleLineVisibleHeight =
      (await visibleBox.boundingBox())?.height || 0;

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

    // The visible box has to actually grow, not clip the second line.
    const expandedVisibleHeight = (await visibleBox.boundingBox())?.height || 0;
    expect(expandedVisibleHeight).toBeGreaterThan(singleLineVisibleHeight);

    // Both lines stay on screen once focus moves away.
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el instanceof HTMLElement) {
        el.blur();
      }
    });
    await expect(editor).not.toBeFocused();
    expect(
      (await visibleBox.boundingBox())?.height || 0,
    ).toBeGreaterThanOrEqual(expandedVisibleHeight);
  };

  /**
   * The WHERE input as a whole, located from its language switch — the one part
   * present in both languages, and the only stable handle now that the input
   * carries no visible label.
   */
  const getWhereRow = (page: Page, formSelector?: string): Locator => {
    const container = formSelector ? page.locator(formSelector) : page;
    return container
      .getByTestId('where-language-switch')
      .first()
      .locator('xpath=..');
  };

  /**
   * The language switch sits flush against the input, sharing a seam, so the
   * two have to be the same height. They are sized independently — the switch
   * from its own SCSS, the input from whichever editor the language selects —
   * and an editor that reserved a taller row than its bordered box left the
   * switch overhanging it.
   */
  const expectSeamFlush = async (row: Locator): Promise<void> => {
    const heights = await row.evaluate(el => {
      const addon = el.querySelector('[data-testid="where-language-switch"]');
      // The box the user sees a border around: the SQL editor's Paper, or the
      // Lucene textarea's wrapper.
      const bordered = Array.from(el.querySelectorAll('*')).find(
        node =>
          addon?.contains(node) === false &&
          parseFloat(getComputedStyle(node).borderTopWidth) > 0,
      );
      return {
        addon: addon?.getBoundingClientRect().height ?? 0,
        input: bordered?.getBoundingClientRect().height ?? 0,
      };
    });

    expect(heights.addon).toBeGreaterThan(0);
    expect(heights.input).toBeGreaterThan(0);
    expect(heights.addon).toBe(heights.input);
  };

  const getEditor = (
    page: Page,
    mode: 'SQL' | 'Lucene',
    formSelector?: string,
  ): Locator => {
    if (mode === 'SQL') {
      return getWhereRow(page, formSelector).locator('.cm-editor').first();
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
    },
    {
      path: '/dashboards',
      name: 'Dashboard Page',
      formSelector: undefined,
    },
  ];

  tests.forEach(({ path, name, formSelector }) => {
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
        const dashboardsListPage = new DashboardsListPage(page);
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await page.getByRole('combobox', { name: 'Query language' }).click();
        await page.getByRole('option', { name: 'SQL', exact: true }).click();
        // Wait for dropdown to close so the WHERE input is not covered
        await page
          .getByRole('option', { name: 'SQL', exact: true })
          .waitFor({ state: 'hidden', timeout: 5000 });
      }

      const editor = getEditor(page, 'SQL', formSelector);
      await expect(editor).toBeVisible();
      await testInputExpansion(page, editor, getWhereRow(page, formSelector), {
        // CodeMirror: .cm-editor can stay fixed; .cm-content height reflects line count
        growthLocator: editor.locator('.cm-content').first(),
        // The Paper wrapping this editor is the box that clips it, so measure
        // that rather than any Paper on the page.
        visibleBoxLocator: editor.locator(
          'xpath=ancestor::div[contains(@class, "mantine-Paper-root")][1]',
        ),
      });
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
        const dashboardsListPage = new DashboardsListPage(page);
        await dashboardsListPage.goto();
        await dashboardsListPage.createNewDashboard();
        await page.getByRole('combobox', { name: 'Query language' }).click();
        await page.getByRole('option', { name: 'Lucene', exact: true }).click();
        // Wait for dropdown to close so the search input is not covered
        await page
          .getByRole('option', { name: 'Lucene', exact: true })
          .waitFor({ state: 'hidden', timeout: 5000 });
      }

      const editor = getEditor(page, 'Lucene', formSelector);
      await expect(editor).toBeVisible();
      await testInputExpansion(page, editor, getWhereRow(page, formSelector));
    });
  });

  test('should keep SELECT and ORDER BY expanded after blur', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto();

    const selectPaper = page
      .getByText('SELECT', { exact: true })
      .locator(
        'xpath=ancestor::div[contains(@class, "mantine-Paper-root")][1]',
      );
    const selectEditor = selectPaper.locator('.cm-editor');
    await expect(selectEditor).toBeVisible();
    await selectEditor.locator('.cm-content').press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await testInputExpansion(page, selectEditor, undefined, {
      growthLocator: selectEditor.locator('.cm-content'),
      visibleBoxLocator: selectPaper,
    });

    const orderByPaper = page
      .getByText('ORDER BY', { exact: true })
      .locator(
        'xpath=ancestor::div[contains(@class, "mantine-Paper-root")][1]',
      );
    const orderByEditor = orderByPaper.locator('.cm-editor');
    await expect(orderByEditor).toBeVisible();
    await orderByEditor.locator('.cm-content').press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await testInputExpansion(page, orderByEditor, undefined, {
      growthLocator: orderByEditor.locator('.cm-content'),
      visibleBoxLocator: orderByPaper,
    });
  });
});
