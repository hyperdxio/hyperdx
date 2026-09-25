import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.use({ viewport: { width: 1280, height: 900 } });

test.describe('Virtualized row heights', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.submitEmptySearch();
    await expect(searchPage.table.firstRow).toBeVisible();
  });

  // An expanded row used to take over its row's slot in the virtualizer's
  // measurement cache and leave its height behind when it collapsed. Every
  // expand/collapse shrank the render window until the viewport went blank.
  test('collapsing an expanded row restores the table height', async () => {
    const before = await searchPage.table.getVirtualizationMetrics();
    expect(before.renderedRows).toBeGreaterThan(20);

    for (const index of [0, 1, 2]) {
      await searchPage.table.expandRow(index);
      await expect(searchPage.table.firstExpandedRow).toBeVisible();

      await searchPage.table.collapseRow(index);
      await expect(searchPage.table.expandedRows).toHaveCount(0);

      await expect
        .poll(async () => {
          const m = await searchPage.table.getVirtualizationMetrics();
          return m.renderedRows;
        })
        .toBe(before.renderedRows);
    }

    const after = await searchPage.table.getVirtualizationMetrics();
    expect(after.scrollHeight).toBeLessThanOrEqual(before.scrollHeight + 20);
  });

  test('scrolling after expanding keeps the viewport filled', async () => {
    for (const index of [0, 1, 2]) {
      await searchPage.table.expandRow(index);
      await expect(searchPage.table.firstExpandedRow).toBeVisible();
      await searchPage.table.collapseRow(index);
      await expect(searchPage.table.expandedRows).toHaveCount(0);
    }

    for (const top of [300, 700, 1200]) {
      await searchPage.table.scrollTo(top);

      await expect
        .poll(async () => {
          const m = await searchPage.table.getVirtualizationMetrics();
          // Rows still below, so the rendered window must cover the viewport.
          return m.remainingBelowPx > 0 ? m.visibleGapPx : 0;
        })
        .toBeLessThanOrEqual(0);
    }
  });
});
