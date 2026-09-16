import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Search side panel navigation', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('a log without trace context does not offer View Trace', async () => {
    await test.step('Open the most recent log row (no TraceId)', async () => {
      // The newest seeded logs carry no TraceId (only the earliest 10 are linked
      // to traces), so the first row of an unfiltered search is a non-trace log.
      await searchPage.submitEmptySearch();
      await expect(searchPage.table.firstRow).toBeVisible();
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.tabs).toBeVisible();
    });

    await test.step('View Trace / Trace tab are absent for a log with no trace', async () => {
      // No trace context → no cross-source action...
      await expect(searchPage.sidePanel.viewTraceButton).toHaveCount(0);
      // ...and logs never render a Trace tab (it is gated behind a Trace source).
      await expect(searchPage.sidePanel.getTab('trace')).toHaveCount(0);
    });
  });

  test('View Trace pushes the trace and Back returns to the log', async ({
    page,
  }) => {
    await test.step('Open a trace-linked log row', async () => {
      await searchPage.openTraceLinkedLogRow('trace-0');
      // Single crumb (the log root) before any cross-source push.
      await expect(searchPage.sidePanel.breadcrumbs).toBeVisible();
      await expect(searchPage.sidePanel.getBreadcrumb(0)).toBeVisible();
      await expect(searchPage.sidePanel.getBreadcrumb(1)).toHaveCount(0);
      // The cross-source action is offered because the log has trace context.
      await expect(searchPage.sidePanel.viewTraceButton).toBeVisible();
    });

    await test.step('Click View Trace → the trace opens in place with a 2-level trail', async () => {
      await searchPage.sidePanel.clickViewTrace();

      // The drawer content is now the trace source: the Trace tab + its content
      // render (a log source has neither).
      await expect(page.getByTestId('side-panel-tab-trace')).toBeVisible({
        timeout: 10_000,
      });
      await expect(searchPage.sidePanel.getTab('trace')).toBeVisible();

      // The breadcrumb trail grew to log › trace (root crumb + current crumb).
      await expect(searchPage.sidePanel.getBreadcrumb(0)).toBeVisible();
      await expect(searchPage.sidePanel.getBreadcrumb(1)).toBeVisible();

      // Still one drawer — no second panel stacked on top.
      await expect(page.getByTestId('row-side-panel')).toHaveCount(1);
    });

    await test.step('Back pops the trace and restores the log panel', async () => {
      await searchPage.sidePanel.back();

      // Trace content is gone and the log tabs are back (Column Values is
      // always present for a log source, and there is no Trace tab).
      await expect(page.getByTestId('side-panel-tab-trace')).toBeHidden();
      await expect(searchPage.sidePanel.getTab('trace')).toHaveCount(0);
      await expect(searchPage.sidePanel.getTab('parsed')).toBeVisible();

      // The trail collapsed back to a single crumb (the log root).
      await expect(searchPage.sidePanel.getBreadcrumb(1)).toHaveCount(0);
    });
  });

  test('a shared deep link restores the trace view and breadcrumb trail', async ({
    page,
  }) => {
    await test.step('Build a log → trace trail', async () => {
      await searchPage.openTraceLinkedLogRow('trace-0');
      await searchPage.sidePanel.clickViewTrace();
      await expect(page.getByTestId('side-panel-tab-trace')).toBeVisible({
        timeout: 10_000,
      });
    });

    // The trail lives entirely in the URL (rowWhere + sidePanelSourceStack +
    // sidePanelStackRoot + sidePanelTab), so a shared link must reconstruct it.
    let deepLink = '';
    await test.step('Capture the deep link and navigate away to a clean page', async () => {
      deepLink = page.url();
      expect(deepLink).toContain('sidePanelSourceStack');
      expect(deepLink).toContain('sidePanelStackRoot');

      await page.goto('/search');
      await searchPage.table.waitForRowsToPopulate();
      // No drawer on a fresh /search with no params.
      await expect(page.getByTestId('row-side-panel')).toHaveCount(0);
    });

    await test.step('Opening the deep link restores the trace view + trail', async () => {
      await page.goto(deepLink);

      // The owner-gated trail (stackRoot === base rowWhere) is not stale, so the
      // trace re-opens in place with its breadcrumb trail intact.
      await expect(page.getByTestId('side-panel-tab-trace')).toBeVisible({
        timeout: 15_000,
      });
      await expect(searchPage.sidePanel.getBreadcrumb(0)).toBeVisible();
      await expect(searchPage.sidePanel.getBreadcrumb(1)).toBeVisible();
    });

    await test.step('Back still returns to the originating log', async () => {
      await searchPage.sidePanel.back();
      await expect(page.getByTestId('side-panel-tab-trace')).toBeHidden();
      await expect(searchPage.sidePanel.getTab('parsed')).toBeVisible();
      await expect(searchPage.sidePanel.getBreadcrumb(1)).toHaveCount(0);
    });
  });
});
