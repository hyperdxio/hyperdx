import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

const VIEWER_OPTIONS_KEY = 'hdx_json_viewer_options';

test.describe('JSON Viewer WhiteSpace Toggle', { tag: ['@search'] }, () => {
  let searchPage: SearchPage;

  async function openParsedTab(searchPage: SearchPage) {
    await searchPage.goto();
    await searchPage.submitEmptySearch();
    await expect(searchPage.table.firstRow).toBeVisible({ timeout: 10000 });
    await searchPage.table.clickFirstRow();
    await searchPage.sidePanel.clickTab('parsed');
  }

  test('should default to pre-wrap (wrapping enabled)', async ({ page }) => {
    searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    // Find a string value in the JSON viewer and check its white-space
    const stringEl = page.locator('[class*="string"]').first();
    await expect(stringEl).toBeVisible();
    await expect(stringEl).toHaveCSS('white-space', 'pre-wrap');
  });

  test('should toggle between pre-wrap and pre', async ({ page }) => {
    searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    const wrapToggle = page.getByTestId('json-viewer-wrap-toggle');
    const stringEl = page.locator('[class*="string"]').first();
    await expect(stringEl).toBeVisible();

    // Default is pre-wrap
    await expect(stringEl).toHaveCSS('white-space', 'pre-wrap');

    // Click toggle → should switch to pre
    await wrapToggle.click();
    await expect(stringEl).toHaveCSS('white-space', 'pre');

    // Click again → should switch back to pre-wrap
    await wrapToggle.click();
    await expect(stringEl).toHaveCSS('white-space', 'pre-wrap');
  });

  test('should persist toggle state in localStorage', async ({ page }) => {
    searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    const wrapToggle = page.getByTestId('json-viewer-wrap-toggle');
    await wrapToggle.click();

    // Verify localStorage was updated
    const stored = await page.evaluate(
      key => localStorage.getItem(key),
      VIEWER_OPTIONS_KEY,
    );
    const parsed = JSON.parse(stored!);
    expect(parsed.whiteSpace).toBe('pre');
    expect(parsed).not.toHaveProperty('lineWrap');
  });

  test('should migrate old lineWrap: true (no-wrap default) to use new default', async ({
    page,
  }) => {
    // Seed old format before navigating
    await page.addInitScript(key => {
      localStorage.setItem(
        key,
        JSON.stringify({
          normallyExpanded: true,
          lineWrap: true,
          tabulate: true,
          filterBlanks: false,
        }),
      );
    }, VIEWER_OPTIONS_KEY);

    searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    // Old lineWrap: true → whiteSpace: undefined → falls back to pre-wrap default
    const stringEl = page.locator('[class*="string"]').first();
    await expect(stringEl).toBeVisible();
    await expect(stringEl).toHaveCSS('white-space', 'pre-wrap');

    // Verify migration happened in localStorage
    const stored = await page.evaluate(
      key => localStorage.getItem(key),
      VIEWER_OPTIONS_KEY,
    );
    const parsed = JSON.parse(stored!);
    expect(parsed).not.toHaveProperty('lineWrap');
  });

  test('should visually wrap long text in pre-wrap mode and overflow in pre mode', async ({
    page,
  }) => {
    // Use a narrow viewport to force wrapping
    await page.setViewportSize({ width: 800, height: 600 });

    searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    const wrapToggle = page.getByTestId('json-viewer-wrap-toggle');

    // Find a string element with content
    const stringEl = page.locator('[class*="string"]').first();
    await expect(stringEl).toBeVisible();

    // Inject a very long string into the first string element to guarantee overflow
    await page.evaluate(() => {
      const el = document.querySelector('[class*="string"]');
      if (el) {
        el.textContent = 'A'.repeat(500) + ' BREAK_HERE ' + 'B'.repeat(500);
      }
    });

    // In pre-wrap mode (default): element should wrap, so scrollWidth <= clientWidth of container
    const preWrapDimensions = await stringEl.evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      offsetHeight: (el as HTMLElement).offsetHeight,
    }));

    // Toggle to pre mode (no wrap)
    await wrapToggle.click();

    // Re-inject the long string (toggle may have re-rendered)
    await page.evaluate(() => {
      const el = document.querySelector('[class*="string"]');
      if (el) {
        el.textContent = 'A'.repeat(500) + ' BREAK_HERE ' + 'B'.repeat(500);
      }
    });

    const preDimensions = await stringEl.evaluate(el => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      offsetHeight: (el as HTMLElement).offsetHeight,
    }));

    // In pre-wrap mode: text should wrap, making the element taller
    // In pre mode: text should not wrap, making it wider (scrollWidth > clientWidth)
    // or shorter height
    expect(preWrapDimensions.offsetHeight).toBeGreaterThan(
      preDimensions.offsetHeight,
    );
  });

  test('should migrate old lineWrap: false (user wanted wrapping) to pre-wrap', async ({
    page,
  }) => {
    // Seed old format — user had explicitly toggled wrapping on
    await page.addInitScript(key => {
      localStorage.setItem(
        key,
        JSON.stringify({
          normallyExpanded: true,
          lineWrap: false,
          tabulate: true,
          filterBlanks: false,
        }),
      );
    }, VIEWER_OPTIONS_KEY);

    searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    // Old lineWrap: false → whiteSpace: 'pre-wrap'
    const stringEl = page.locator('[class*="string"]').first();
    await expect(stringEl).toBeVisible();
    await expect(stringEl).toHaveCSS('white-space', 'pre-wrap');

    // Verify migration wrote pre-wrap explicitly
    const stored = await page.evaluate(
      key => localStorage.getItem(key),
      VIEWER_OPTIONS_KEY,
    );
    const parsed = JSON.parse(stored!);
    expect(parsed.whiteSpace).toBe('pre-wrap');
    expect(parsed).not.toHaveProperty('lineWrap');
  });
});
