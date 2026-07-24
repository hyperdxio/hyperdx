/**
 * E2E coverage for the "Share" button that copies a shareable link to the
 * clipboard on the search page, Chart Explorer, dashboards, and the row/session
 * side panels.
 *
 * Verifies the whole round-trip: click Share -> a URL lands on the clipboard ->
 * opening it restores the view. Also asserts the two link shapes: large state
 * (Chart Explorer) is compressed into a `?share=` token that expands on load,
 * while a path-identified dashboard stays a plain URL.
 */
import { ChartExplorerPage } from '../../page-objects/ChartExplorerPage';
import { DashboardPage } from '../../page-objects/DashboardPage';
import { SearchPage } from '../../page-objects/SearchPage';
import { SessionsPage } from '../../page-objects/SessionsPage';
import { expect, test } from '../../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../../utils/constants';

test.describe('Share link', { tag: ['@share', '@full-stack'] }, () => {
  // Reading the clipboard back requires these context permissions; localhost is
  // a secure context, so navigator.clipboard works once granted.
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('search: copies a link that restores the selected source and time', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto();
    // Switch to a non-default source so restoring it is unambiguous proof the
    // link carried the state (not just the page default).
    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await searchPage.timePicker.selectRelativeTime('Last 1 days');
    await searchPage.submitEmptySearch();

    const link = await searchPage.share.copyAndReadLink();
    expect(link).toContain('/search');

    // Open the shared link fresh and confirm the view is restored from the URL.
    await page.goto(link);
    await expect(searchPage.currentSource).toHaveValue(
      DEFAULT_TRACES_SOURCE_NAME,
      { timeout: 15000 },
    );
    // The time range was frozen to an absolute window on share.
    const reopened = new URL(page.url()).searchParams;
    expect(reopened.get('from')).toBeTruthy();
    expect(reopened.get('to')).toBeTruthy();

    // A compressed `?share=` token expands back to normal params after load.
    if (new URL(link).searchParams.has('share')) {
      expect(reopened.has('share')).toBe(false);
    }
  });

  test('dashboard: copies a plain (uncompressed) link for the dashboard', async ({
    page,
  }) => {
    const dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
    await dashboardPage.createNewDashboard();
    await dashboardPage.waitForLoaded();
    const dashboardId = dashboardPage.getCurrentDashboardId();

    await expect(dashboardPage.share.shareButton).toBeVisible();
    const link = await dashboardPage.share.copyAndReadLink();

    // Dashboard identity lives in the path and its transient state is tiny, so
    // the link stays plain (compression would only make it longer).
    expect(link).toContain(`/dashboards/${dashboardId}`);
    expect(new URL(link).searchParams.has('share')).toBe(false);
  });

  test('chart explorer: copies a compressed link that restores the chart', async ({
    page,
  }) => {
    const chartPage = new ChartExplorerPage(page);
    await chartPage.goto();
    await expect(chartPage.form).toBeVisible();
    await chartPage.chartEditor.selectSource(DEFAULT_LOGS_SOURCE_NAME);
    await chartPage.chartEditor.runQuery();
    await expect(chartPage.getFirstChart()).toBeVisible();

    const link = await chartPage.share.copyAndReadLink();
    expect(link).toContain('/chart');
    // The chart config is a large JSON blob, so the link is compressed.
    expect(new URL(link).searchParams.has('share')).toBe(true);

    // Opening it expands the token back to normal params and re-renders.
    await page.goto(link);
    await expect
      .poll(() => new URL(page.url()).searchParams.has('share'))
      .toBe(false);
    await expect(chartPage.getFirstChart()).toBeVisible();
  });

  test('row side panel: shares a link from the row detail drawer', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto();
    // Non-default source, so restoring it proves the panel's Share copied the
    // full view link (not just the page default).
    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await searchPage.timePicker.selectRelativeTime('Last 1 days');
    await searchPage.submitEmptySearch();
    await expect(searchPage.table.firstRow).toBeVisible();

    // Open the row detail drawer, then share from its header.
    await searchPage.table.clickFirstRow();
    await expect(searchPage.sidePanel.tabs).toBeVisible();
    await expect(searchPage.sidePanel.shareButton).toBeVisible();

    const link = await searchPage.sidePanel.shareAndReadLink();
    expect(link).toContain('/search');

    await page.goto(link);
    await expect(searchPage.currentSource).toHaveValue(
      DEFAULT_TRACES_SOURCE_NAME,
      { timeout: 15000 },
    );
  });

  test('session side panel: shares a link from the session replay drawer', async ({
    page,
  }) => {
    const sessionsPage = new SessionsPage(page);
    // Priming /search first mirrors the existing sessions specs and ensures the
    // source fixtures are in place before the sessions list loads.
    await page.goto('/search');
    await sessionsPage.goto();
    await sessionsPage.selectDataSource();
    await expect(sessionsPage.getFirstSessionCard()).toBeVisible();
    await sessionsPage.openFirstSession();
    await expect(sessionsPage.sessionSidePanel).toBeVisible();

    await expect(sessionsPage.shareSessionButton).toBeVisible();
    const link = await sessionsPage.shareAndReadLink();
    expect(link).toContain('/sessions');
  });
});
