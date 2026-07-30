import { Page } from '@playwright/test';

import { SearchPage } from '../page-objects/SearchPage';
import { getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_SESSIONS_SOURCE_NAME,
  DEFAULT_TRACES_MV_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
  K8S_LOGS_NO_METRICS_SOURCE_NAME,
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

/** The ID the API assigned to a seeded source, to assert canonicalization against. */
async function sourceIdByName(
  page: Page,
  kind: 'log' | 'trace' | 'metric' | 'session',
  name: string,
) {
  const sources = await getSources(page, kind);
  const match = sources.find((s: { name: string }) => s.name === name);
  expect(match, `seeded ${kind} source "${name}"`).toBeDefined();
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return match.id as string;
}

/**
 * Records every notification that appears, so a test can assert one *didn't*
 * fire. A plain `toHaveCount(0)` can't: these warnings auto-close, so the
 * assertion passes either way if it runs after the toast has gone. Call before
 * navigating.
 */
async function recordNotifications(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = [];
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    (window as unknown as { __notifications: string[] }).__notifications = seen;
    new MutationObserver(records => {
      for (const record of records) {
        record.addedNodes.forEach(node => {
          if (!(node instanceof HTMLElement)) return;
          const root = node.closest('.mantine-Notification-root') ?? node;
          if (root.querySelector?.('.mantine-Notification-title') != null) {
            seen.push(root.textContent ?? '');
          }
        });
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

function getRecordedNotifications(page: Page) {
  return page.evaluate(
    () =>
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
      (window as unknown as { __notifications?: string[] }).__notifications ??
      [],
  );
}

/**
 * Waits for the URL to stop changing. Several pages write params for a moment
 * after load (a canonicalization, a submit); a navigation started while one of
 * those is in flight is cancelled and re-issued by Next with the query merged in,
 * which is a pre-existing race and not what these tests are about.
 */
async function waitForUrlToSettle(page: Page) {
  let previous = '';
  for (let i = 0; i < 20; i++) {
    const current = page.url();
    if (current === previous) return;
    previous = current;
    // eslint-disable-next-line playwright/no-wait-for-timeout
    await page.waitForTimeout(300);
  }
}

/** Every source picker on these pages renders with this placeholder. */
function sourcePicker(page: Page, index = 0) {
  return page.getByPlaceholder('Data Source').nth(index);
}

async function expectParamCanonicalized(
  page: Page,
  param: string,
  expectedId: string,
) {
  await expect
    .poll(() => new URL(page.url()).searchParams.get(param), {
      timeout: 15000,
    })
    .toBe(expectedId);
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

  test('opens the service map with a source name', async ({ page }) => {
    // Deliberately not the *default* trace source: the page falls back to the
    // first one, so only a non-default source proves the param was honoured
    // rather than dropped on the cold load.
    const traceSourceId = await sourceIdByName(
      page,
      'trace',
      DEFAULT_TRACES_MV_SOURCE_NAME,
    );

    await page.goto(
      `/service-map?source=${encodeURIComponent(DEFAULT_TRACES_MV_SOURCE_NAME)}`,
    );

    await expect(page.getByTestId('service-map-page')).toBeVisible({
      timeout: 15000,
    });
    await expect(sourcePicker(page)).toHaveValue(DEFAULT_TRACES_MV_SOURCE_NAME);
    await expectParamCanonicalized(page, 'source', traceSourceId);
  });

  test('keeps writing the picked source to the param after earlier param writes', async ({
    page,
  }) => {
    const traceSourceId = await sourceIdByName(
      page,
      'trace',
      DEFAULT_TRACES_SOURCE_NAME,
    );
    const mvTraceSourceId = await sourceIdByName(
      page,
      'trace',
      DEFAULT_TRACES_MV_SOURCE_NAME,
    );

    // Arrive by name so the page canonicalizes the param — a write that must not
    // be mistaken for leaving the page. nuqs updates params through the Next
    // router here, so each one emits the same event a real navigation does.
    await page.goto(
      `/service-map?source=${encodeURIComponent(DEFAULT_TRACES_SOURCE_NAME)}`,
    );
    await expect(page.getByTestId('service-map-page')).toBeVisible({
      timeout: 15000,
    });
    await expectParamCanonicalized(page, 'source', traceSourceId);

    // Two picks: the first one's own param write is itself another chance to
    // wedge the page, which the second pick would then expose.
    for (const [name, id] of [
      [DEFAULT_TRACES_MV_SOURCE_NAME, mvTraceSourceId],
      [DEFAULT_TRACES_SOURCE_NAME, traceSourceId],
    ] as const) {
      await sourcePicker(page).click();
      await page.getByRole('option', { name, exact: true }).click();

      // The form is driven by the param, so a param that stops following the
      // dropdown also reverts what the map displays.
      await expect(sourcePicker(page)).toHaveValue(name);
      await expectParamCanonicalized(page, 'source', id);
    }
  });

  test('opens the services dashboard with a source name', async ({ page }) => {
    // A non-default trace source, so the fallback can't mask a dropped param.
    const traceSourceId = await sourceIdByName(
      page,
      'trace',
      DEFAULT_TRACES_MV_SOURCE_NAME,
    );

    // React reports a runaway render/effect cycle as "Maximum update depth
    // exceeded"; this page has several effects that write params from form state.
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // The preset-filter request is keyed on the page's source; an unresolved
    // value used to be sent verbatim.
    const failed: string[] = [];
    page.on('response', res => {
      if (res.url().includes('dashboards/preset') && res.status() >= 400) {
        failed.push(`${res.status()} ${res.url()}`);
      }
    });

    await page.goto(
      `/services?source=${encodeURIComponent(DEFAULT_TRACES_MV_SOURCE_NAME)}&where=ServiceName%3Afrontend&whereLanguage=lucene`,
    );

    await expect(page.getByTestId('services-dashboard-page')).toBeVisible({
      timeout: 15000,
    });
    await expect(sourcePicker(page)).toHaveValue(DEFAULT_TRACES_MV_SOURCE_NAME);
    // The tabs only render once a trace source resolved.
    await expect(page.getByRole('tab', { name: 'HTTP Service' })).toBeVisible();
    await expectParamCanonicalized(page, 'source', traceSourceId);
    // The rest of the link survives: the page submits its form on load, so a
    // `where` it never read would be written back as empty.
    const params = new URL(page.url()).searchParams;
    expect(params.get('where')).toBe('ServiceName:frontend');
    expect(params.get('whereLanguage')).toBe('lucene');
    expect(failed).toEqual([]);
    expect(
      consoleErrors.filter(e => e.includes('Maximum update depth')),
    ).toEqual([]);
  });

  // `/search`, `/service-map` and `/services` all carry their current source in
  // the same `source` param, and each mirrors its own choice into it. During a
  // client-side transition the outgoing page is still mounted while the
  // destination renders, so without a guard the two overwrite each other's value
  // until React bails out with "Maximum update depth exceeded".
  const SHARED_SOURCE_PARAM_PAGES = [
    { path: '/service-map', testId: 'service-map-page' },
    { path: '/services', testId: 'services-dashboard-page' },
    { path: '/search', testId: 'search-results-panel' },
  ] as const;

  for (const from of SHARED_SOURCE_PARAM_PAGES) {
    for (const to of SHARED_SOURCE_PARAM_PAGES) {
      if (from === to) continue;

      test(`hands the shared source param over from ${from.path} to ${to.path}`, async ({
        page,
      }) => {
        // A non-default trace source, so the origin insists on something the
        // destination wouldn't have picked for itself.
        const traceSourceId = await sourceIdByName(
          page,
          'trace',
          DEFAULT_TRACES_MV_SOURCE_NAME,
        );

        const consoleErrors: string[] = [];
        page.on('console', msg => {
          if (msg.type() === 'error') consoleErrors.push(msg.text());
        });

        await page.goto(`${from.path}?source=${traceSourceId}`);
        await expect(page.getByTestId(from.testId)).toBeVisible({
          timeout: 15000,
        });
        expect(new URL(page.url()).searchParams.get('source')).toBe(
          traceSourceId,
        );

        await waitForUrlToSettle(page);
        await page.evaluate(path => {
          const nextWindow =
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            window as unknown as {
              next: { router: { push: (u: string) => void } };
            };
          nextWindow.next.router.push(path);
        }, to.path);

        await expect(page.getByTestId(to.testId)).toBeVisible({
          timeout: 15000,
        });

        // Like the sidebar links, the push carries no query, so the destination
        // picking its own source is expected. What must not happen is the param
        // continuing to move afterwards: sample rather than poll, because the
        // failure is the value *changing*, not never matching.
        const samples: (string | null)[] = [];
        for (let i = 0; i < 4; i++) {
          // eslint-disable-next-line playwright/no-wait-for-timeout
          await page.waitForTimeout(400);
          samples.push(new URL(page.url()).searchParams.get('source'));
        }
        const settled = samples[0];
        expect(samples).toEqual([settled, settled, settled, settled]);
        expect(
          consoleErrors.filter(e => e.includes('Maximum update depth')),
        ).toEqual([]);
      });
    }
  }

  test('opens sessions with a source name', async ({ page }) => {
    const sessionSourceId = await sourceIdByName(
      page,
      'session',
      DEFAULT_SESSIONS_SOURCE_NAME,
    );

    await page.goto(
      `/sessions?sessionSource=${encodeURIComponent(DEFAULT_SESSIONS_SOURCE_NAME)}`,
    );

    await expect(page.getByTestId('sessions-page')).toBeVisible({
      timeout: 15000,
    });
    await expect(sourcePicker(page)).toHaveValue(DEFAULT_SESSIONS_SOURCE_NAME);
    await expectParamCanonicalized(page, 'sessionSource', sessionSourceId);
  });

  test('opens the chart explorer with a source name in the config', async ({
    page,
  }) => {
    const logSources = await getSources(page, 'log');
    const logsSource = logSources.find(
      (s: { name: string }) => s.name === DEFAULT_LOGS_SOURCE_NAME,
    );
    expect(logsSource).toBeDefined();

    // A minimal builder config with the source given by *name*. `connection`
    // comes from the API so the chart can actually query — /chart autoRuns.
    const config = {
      name: '',
      select: [
        {
          aggFn: 'count',
          aggCondition: '',
          aggConditionLanguage: 'lucene',
          valueExpression: '',
        },
      ],
      where: '',
      whereLanguage: 'lucene',
      displayType: 'line',
      granularity: 'auto',
      alignDateRangeToGranularity: true,
      source: DEFAULT_LOGS_SOURCE_NAME,
      connection: logsSource.connection,
    };

    await page.goto(
      `/chart?config=${encodeURIComponent(JSON.stringify(config))}`,
    );

    await expect(page.getByTestId('chart-explorer-page')).toBeVisible({
      timeout: 15000,
    });
    // Scoped to the editor: the AI assistant reuses the `source-selector` id.
    const chartForm = page.getByTestId('chart-explorer-form');
    await expect(chartForm.getByTestId('source-selector')).toHaveValue(
      DEFAULT_LOGS_SOURCE_NAME,
      { timeout: 15000 },
    );
    // A resolved source means the query can be built and the chart drawn.
    await expect(
      page.locator('.recharts-responsive-container').first(),
    ).toBeVisible({ timeout: 20000 });
  });

  test('warns and keeps the link when the session source does not exist', async ({
    page,
  }) => {
    const warning = waitForNotification(page, 'Source not found');
    await page.goto('/sessions?sessionSource=Deleted%20Sessions');
    await warning;

    await expect(page.getByTestId('sessions-page')).toBeVisible();
    // The page must not submit its (empty) form over the param: that would drop
    // the link, and with it the explanation of why nothing is selected.
    expect(new URL(page.url()).searchParams.get('sessionSource')).toBe(
      'Deleted Sessions',
    );
    await expect(sourcePicker(page)).toHaveValue('');
  });

  test('does not rewrite the kubernetes log source it was given', async ({
    page,
  }) => {
    await recordNotifications(page);

    // This log source has no correlated metric source, so the metric half is
    // filled in from the shared connection. If the form catching up to the
    // derived pair is mistaken for a user pick, the metric source's own
    // correlation writes *back* over the log source — replacing the one the link
    // asked for, and looping through the derivation while it does it.
    const logSourceId = await sourceIdByName(
      page,
      'log',
      K8S_LOGS_NO_METRICS_SOURCE_NAME,
    );

    // React reports the runaway version of that feedback loop as
    // "Maximum update depth exceeded".
    const consoleErrors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await page.goto(
      `/kubernetes?logSource=${encodeURIComponent(K8S_LOGS_NO_METRICS_SOURCE_NAME)}`,
    );

    await expect(page.getByTestId('kubernetes-dashboard-page')).toBeVisible({
      timeout: 15000,
    });
    await expect(sourcePicker(page, 0)).toHaveValue(
      K8S_LOGS_NO_METRICS_SOURCE_NAME,
    );
    await expectParamCanonicalized(page, 'logSource', logSourceId);
    expect(await getRecordedNotifications(page)).toEqual([]);
    expect(
      consoleErrors.filter(e => e.includes('Maximum update depth')),
    ).toEqual([]);
  });

  test('opens the kubernetes dashboard with a source name', async ({
    page,
  }) => {
    await recordNotifications(page);

    const logSourceId = await sourceIdByName(
      page,
      'log',
      DEFAULT_LOGS_SOURCE_NAME,
    );
    const metricSourceId = await sourceIdByName(
      page,
      'metric',
      DEFAULT_METRICS_SOURCE_NAME,
    );

    // Only the log source is given, so the page correlates the metric source
    // itself — which is also what makes a spurious "Updated Metrics Source"
    // notice observable if the resolution flip is mistaken for a user pick.
    await page.goto(
      `/kubernetes?logSource=${encodeURIComponent(DEFAULT_LOGS_SOURCE_NAME)}`,
    );

    await expect(page.getByTestId('kubernetes-dashboard-page')).toBeVisible({
      timeout: 15000,
    });
    await expect(sourcePicker(page, 0)).toHaveValue(DEFAULT_LOGS_SOURCE_NAME);
    await expect(sourcePicker(page, 1)).toHaveValue(
      DEFAULT_METRICS_SOURCE_NAME,
    );
    await expectParamCanonicalized(page, 'logSource', logSourceId);
    await expectParamCanonicalized(page, 'metricSource', metricSourceId);

    // Filling in the missing half on load is expected; announcing it as though
    // the user had just switched sources is not.
    expect(await getRecordedNotifications(page)).toEqual([]);
  });
});
