import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

const VIEWER_OPTIONS_KEY = 'hdx_json_viewer_options';

// HDX-5115: the viewer sorts keys alphabetically, which is the right default
// for wide ClickHouse Map columns but hides the stored column order. The view
// options menu makes the order a choice.
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
    const { sidePanel } = searchPage;
    await openParsedTab(searchPage);

    const ascKeys = await sidePanel.getJsonViewerTopLevelKeys();
    expect(ascKeys).toEqual(await sidePanel.sortKeysLikeViewer(ascKeys));

    await sidePanel.selectJsonKeyOrder('desc');
    await expect
      .poll(() => sidePanel.getJsonViewerTopLevelKeys(), { timeout: 5000 })
      .toEqual([...ascKeys].reverse());

    await sidePanel.selectJsonKeyOrder('original');
    await expect
      .poll(() => sidePanel.getJsonViewerTopLevelKeys(), { timeout: 5000 })
      .not.toEqual([...ascKeys].reverse());

    // The seeded logs table's column order (Timestamp, TraceId, SpanId, …) is
    // not alphabetical, so the same keys come back in a different sequence.
    const originalKeys = await sidePanel.getJsonViewerTopLevelKeys();
    expect(new Set(originalKeys)).toEqual(new Set(ascKeys));
    expect(originalKeys).not.toEqual(ascKeys);

    const stored = await page.evaluate(
      key => localStorage.getItem(key),
      VIEWER_OPTIONS_KEY,
    );
    expect(JSON.parse(stored!).keyOrder).toBe('original');
  });
});
