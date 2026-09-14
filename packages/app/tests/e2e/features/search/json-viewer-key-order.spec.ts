import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

const VIEWER_OPTIONS_KEY = 'hdx_json_viewer_options';

test.describe('JSON viewer key order', { tag: ['@search'] }, () => {
  async function openParsedTab(searchPage: SearchPage) {
    await searchPage.goto();
    await searchPage.submitEmptySearch();
    await expect(searchPage.table.firstRow).toBeVisible({ timeout: 10000 });
    await searchPage.table.clickFirstRow();
    await searchPage.sidePanel.clickTab('parsed');
  }

  test('changes the property order from the view options menu', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    await openParsedTab(searchPage);

    // Default is A–Z. Assert keys equal their own sorted copy to pin this.
    // Sort is evaluated in the browser so the collation matches the viewer.
    const ascKeys = await searchPage.sidePanel.getJsonViewerTopLevelKeys();
    const sorted = await searchPage.sidePanel.sortKeysInBrowser(ascKeys);
    expect(ascKeys).toEqual(sorted);

    // Switch to Z–A and poll until the viewer re-renders.
    await searchPage.sidePanel.selectJsonKeyOrder('desc');
    await expect
      .poll(() => searchPage.sidePanel.getJsonViewerTopLevelKeys(), {
        timeout: 5000,
      })
      .toEqual([...ascKeys].reverse());

    // Switch to original order and wait for the view to update.
    await searchPage.sidePanel.selectJsonKeyOrder('original');
    await expect
      .poll(() => searchPage.sidePanel.getJsonViewerTopLevelKeys(), {
        timeout: 5000,
      })
      .not.toEqual([...ascKeys].reverse());

    const originalKeys = await searchPage.sidePanel.getJsonViewerTopLevelKeys();

    // Same set of keys, but the seeded column order (Timestamp, TraceId,
    // SpanId, …) is not alphabetical, so original != sorted.
    expect(new Set(originalKeys)).toEqual(new Set(ascKeys));
    expect(originalKeys).not.toEqual(sorted);

    // Confirm the choice was persisted.
    const stored = await page.evaluate(
      key => localStorage.getItem(key),
      VIEWER_OPTIONS_KEY,
    );
    const parsedOptions = JSON.parse(stored!);
    expect(parsedOptions.keyOrder).toBe('original');
  });
});
