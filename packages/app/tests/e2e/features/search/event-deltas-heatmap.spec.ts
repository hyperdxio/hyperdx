import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../../utils/constants';

/**
 * Regression coverage for HDX-4147 (PR #2189): the dashed drag-select
 * rectangle on the Event Deltas heatmap collapses to a 2x2 px residue
 * after mouseup unless u.select is mirrored from the URL state. These
 * tests assert the visible rectangle survives the round-trip through
 * the URL (drag, reload, click-to-clear).
 *
 * nuqs setFields and uPlot's ready hook both flush asynchronously, so
 * URL and bounding-box reads use expect.poll rather than one-shot
 * reads.
 */
test.describe('Event Deltas heatmap drag-select', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await searchPage.openEventDeltasMode();
  });

  test('drag-select draws a persistent rectangle and writes URL state', async () => {
    await searchPage.dragHeatmapSelection();

    // URL gains the four selection params nuqs writes via setFields.
    for (const param of ['xMin=', 'xMax=', 'yMin=', 'yMax=']) {
      await expect
        .poll(() => searchPage.page.url(), {
          message: `URL should carry ${param.slice(0, -1)}`,
        })
        .toContain(param);
    }

    // The dashed rectangle stays visible after mouseup. The bug shipped
    // a 2x2 px collapse pinned to (0, 0); a healthy selection has both
    // dimensions well above that residue.
    await expect
      .poll(
        async () =>
          (await searchPage.getHeatmapSelectionRect().boundingBox())?.width ??
          0,
        { message: 'selection width should reflect the drag' },
      )
      .toBeGreaterThan(20);
    const rect = await searchPage.getHeatmapSelectionRect().boundingBox();
    expect(rect, 'selection element should be in the DOM').not.toBeNull();
    expect(
      rect!.height,
      'selection height should reflect the drag',
    ).toBeGreaterThan(20);
  });

  test('reloading the page restores the rectangle from URL state', async () => {
    await searchPage.dragHeatmapSelection();

    // Wait for the rectangle to settle, then capture it for cross-check.
    await expect
      .poll(
        async () =>
          (await searchPage.getHeatmapSelectionRect().boundingBox())?.width ??
          0,
      )
      .toBeGreaterThan(20);
    const beforeReload = await searchPage
      .getHeatmapSelectionRect()
      .boundingBox();
    expect(beforeReload).not.toBeNull();

    // Round-trip through the URL: a fresh page load goes through the
    // uPlot ready hook path, which is what the on-create path got wrong
    // before the fix (scales aren't populated for mode-2 facet data
    // until the first draw).
    await searchPage.page.reload();
    await searchPage.getHeatmap().waitFor({ state: 'visible' });

    // The ready hook fires after the first draw, which is async relative
    // to the canvas being visible; poll until the rectangle re-renders.
    await expect
      .poll(
        async () =>
          (await searchPage.getHeatmapSelectionRect().boundingBox())?.width ??
          0,
        { message: 'rectangle width should be restored from URL on reload' },
      )
      .toBeGreaterThan(20);
    const afterReload = await searchPage
      .getHeatmapSelectionRect()
      .boundingBox();
    expect(
      afterReload,
      'selection element should be in the DOM after reload',
    ).not.toBeNull();
    expect(
      afterReload!.height,
      'rectangle height should be restored from URL on reload',
    ).toBeGreaterThan(20);

    // Coordinates round-trip with sub-pixel accuracy (small rounding
    // from log-space conversion is acceptable).
    expect(afterReload!.width).toBeCloseTo(beforeReload!.width, 0);
    expect(afterReload!.height).toBeCloseTo(beforeReload!.height, 0);
  });

  test('clicking off the rectangle clears both URL state and the rectangle', async () => {
    await searchPage.dragHeatmapSelection();

    // Sanity: the drag set the URL state. nuqs flushes async, so poll.
    await expect.poll(() => searchPage.page.url()).toContain('xMin=');

    // Click somewhere on the chart canvas that isn't inside the
    // selection. Top edge of the canvas is far enough from the mid-band
    // selection drawn by dragHeatmapSelection() defaults.
    const heatmapBox = await searchPage.getHeatmap().boundingBox();
    if (!heatmapBox) {
      throw new Error('Heatmap not found');
    }
    await searchPage.page.mouse.click(
      heatmapBox.x + heatmapBox.width * 0.9,
      heatmapBox.y + heatmapBox.height * 0.05,
    );

    // URL params drop out (nuqs serializes a null value to no key).
    await expect
      .poll(() => searchPage.page.url(), {
        message: 'xMin should be cleared from URL',
      })
      .not.toContain('xMin=');

    // uPlot resets u.select to width=0/height=0; the element collapses
    // to its 1 px border on each side (2x2 with the border included).
    // The collapse goes through React state, so poll.
    await expect
      .poll(
        async () =>
          (await searchPage.getHeatmapSelectionRect().boundingBox())?.width ??
          0,
        { message: 'rectangle width should collapse on clear' },
      )
      .toBeLessThan(5);
    const afterClear = await searchPage.getHeatmapSelectionRect().boundingBox();
    expect(
      afterClear,
      'selection element should still be in the DOM',
    ).not.toBeNull();
    expect(
      afterClear!.height,
      'rectangle height should collapse on clear',
    ).toBeLessThan(5);
  });
});
