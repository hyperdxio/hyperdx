import { Page } from '@playwright/test';

import { SearchPage } from '../page-objects/SearchPage';
import { getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../utils/constants';

/**
 * `?source=` accepts a source name as well as a source ID so links can be
 * hand-written. Full-stack only: in local mode the fixture sources use their
 * name as their ID, so a name param would resolve through the ID path and prove
 * nothing.
 */
/**
 * Waits for a notification carrying `text`. Call this *before* navigating: these
 * warnings auto-close, so a slow page load can outlast one that was shown while
 * `goto` was still resolving.
 */
function waitForNotification(page: Page, text: string) {
  return page
    .locator('.mantine-Notification-root')
    .filter({ hasText: text })
    .waitFor({ state: 'visible', timeout: 15000 });
}

test.describe('Source name deeplinks', { tag: ['@full-stack'] }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
  });

  test('opens search with a source name and canonicalizes it to the id', async ({
    page,
  }) => {
    const logSources = await getSources(page, 'log');
    const logsSource = logSources.find(
      (s: { name: string }) => s.name === DEFAULT_LOGS_SOURCE_NAME,
    );
    expect(logsSource).toBeDefined();

    await page.goto(
      `/search?source=${encodeURIComponent(DEFAULT_LOGS_SOURCE_NAME)}&select=Timestamp%2C%20Body&orderBy=Timestamp%20DESC`,
    );

    await expect(searchPage.currentSource).toHaveValue(
      DEFAULT_LOGS_SOURCE_NAME,
      { timeout: 10000 },
    );
    await searchPage.table.waitForRowsToPopulate();

    // The name is replaced by the ID it resolves to, and nothing else about the
    // linked config changes — in particular `select` and `orderBy` survive,
    // which a source switch would have cleared.
    await expect
      .poll(() => new URL(page.url()).searchParams.get('source'), {
        timeout: 10000,
      })
      .toBe(logsSource.id);
    const params = new URL(page.url()).searchParams;
    expect(params.get('select')).toBe('Timestamp, Body');
    expect(params.get('orderBy')).toBe('Timestamp DESC');
  });

  test('warns when the source exists but is the wrong kind for this page', async ({
    page,
  }) => {
    const metricSources = await getSources(page, 'metric');
    const metricSourceId: string = metricSources[0].id;

    // Start watching before navigating: the notification auto-closes after a few
    // seconds, which a slow page load can outlast.
    const warning = waitForNotification(page, "Source can't be used here");
    await page.goto(`/search?source=${metricSourceId}`);
    await warning;

    await expect(searchPage.currentSource).toHaveValue('');
  });

  test('resolves a source name on a direct trace link', async ({ page }) => {
    // `/trace/<id>` forwards its query to /search, so the name has to resolve
    // there for the trace panel to open.
    await page.goto(
      `/trace/trace-0?source=${encodeURIComponent(DEFAULT_TRACES_SOURCE_NAME)}`,
    );

    await expect(page).toHaveURL(/\/search\?.*traceId=trace-0/, {
      timeout: 10000,
    });
    await expect(
      page.getByRole('dialog').getByText('Trace', { exact: true }),
    ).toBeVisible({ timeout: 10000 });
    // The panel's "pick a source" empty states mean the param never resolved.
    await expect(page.getByText('Select a trace source')).toBeHidden();
    await expect(page.getByText('Trace source not found')).toBeHidden();
  });

  test('matches a source name case-insensitively', async ({ page }) => {
    await page.goto(
      `/search?source=${encodeURIComponent(DEFAULT_LOGS_SOURCE_NAME.toLowerCase())}`,
    );

    await expect(searchPage.currentSource).toHaveValue(
      DEFAULT_LOGS_SOURCE_NAME,
      { timeout: 10000 },
    );
    await searchPage.table.waitForRowsToPopulate();
  });

  test('warns and selects nothing when the source no longer exists', async ({
    page,
  }) => {
    const warning = waitForNotification(page, 'Source not found');
    await page.goto('/search?source=Deleted%20Source');
    await warning;

    // No default source is substituted, and the link is left as the user sent it.
    await expect(searchPage.currentSource).toHaveValue('');
    expect(new URL(page.url()).searchParams.get('source')).toBe(
      'Deleted Source',
    );
  });

  test('never requests pinned filters for an unresolved source', async ({
    page,
  }) => {
    // The WHERE/SELECT editors and the filter sidebar fetch pinned filters and
    // facets by source ID. Until `?source=<name>` resolves, the page's form value
    // still holds the name, and asking the API for it 400s. Bare /search used to
    // do the same with an empty source.
    const failed: string[] = [];
    page.on('response', res => {
      if (res.url().includes('pinned-filters') && res.status() >= 400) {
        failed.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto(
      `/search?source=${encodeURIComponent(DEFAULT_LOGS_SOURCE_NAME)}`,
    );
    await searchPage.table.waitForRowsToPopulate();
    expect(failed).toEqual([]);

    await page.goto('/search');
    await searchPage.table.waitForRowsToPopulate();
    expect(failed).toEqual([]);
  });

  test('still opens search with a source id', async ({ page }) => {
    const logSources = await getSources(page, 'log');
    const logsSource = logSources.find(
      (s: { name: string }) => s.name === DEFAULT_LOGS_SOURCE_NAME,
    );
    expect(logsSource).toBeDefined();
    const logsSourceId: string = logsSource.id;

    await page.goto(`/search?source=${logsSourceId}`);

    await expect(searchPage.currentSource).toHaveValue(
      DEFAULT_LOGS_SOURCE_NAME,
      { timeout: 10000 },
    );
    await searchPage.table.waitForRowsToPopulate();
    expect(page.url()).toContain(`source=${logsSourceId}`);
  });
});
