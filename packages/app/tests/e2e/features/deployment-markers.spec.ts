/**
 * Deployment markers: releases show up as dashed vertical lines on dashboard
 * tile charts, labelled with the version.
 *
 * Markers are derived from `ResourceAttributes['service.version']` — one marker
 * per version whose first appearance falls inside the visible window. Nothing
 * in the global seed sets that attribute, so this spec seeds its own rows: two
 * versions, each under its own unique service name so parallel specs and the
 * global seed can't contribute markers of their own.
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  E2E_CLICKHOUSE_DATABASE,
  E2E_LOGS_TABLE,
} from '../utils/constants';

const CLICKHOUSE_HOST =
  process.env.CLICKHOUSE_HOST ||
  `http://localhost:${process.env.HDX_E2E_CH_PORT || '20500'}`;
const CLICKHOUSE_USER = process.env.CLICKHOUSE_USER || 'default';
const CLICKHOUSE_PASSWORD = process.env.CLICKHOUSE_PASSWORD || '';

async function clickhouseQuery(sql: string): Promise<void> {
  const url = new URL(CLICKHOUSE_HOST);
  url.searchParams.set('user', CLICKHOUSE_USER);
  if (CLICKHOUSE_PASSWORD) {
    url.searchParams.set('password', CLICKHOUSE_PASSWORD);
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    body: sql,
    headers: { 'Content-Type': 'text/plain' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `ClickHouse query failed (${response.status}): ${errorText}`,
    );
  }
}

// Spread across the dashboard's default "Past 1h" window with ~20 minutes
// between each. Labels collapse into "N deploys" once neighbours are closer
// than roughly half their combined width, and a dashboard tile's plot is only
// a few hundred pixels wide — keep these generously spaced (and the version
// strings short) so the assertions below aren't sitting on that threshold.
const OLD_VERSION_AGO_MS = 50 * 60 * 1000;
const NEW_VERSION_AGO_MS = 8 * 60 * 1000;

// Versions are fixed rather than per-run unique, which makes seeding
// idempotent: a Playwright retry would otherwise add more versions a few
// seconds from the first attempt's — close enough to collapse into a
// "2 deploys" label and break the assertions. Re-inserting the same versions
// still groups to the same markers, since the query is
// `min(Timestamp) GROUP BY version, service`. The global seed truncates the
// table between suite runs, so nothing accumulates.
const OLD_VERSION = 'e2e-1.0.0';
const NEW_VERSION = 'e2e-2.0.0';
const DEPLOY_SERVICE = 'deploy_markers_e2e';

// A second service releasing in the same window. Markers are scoped to the data
// a tile is charting, so filtering to DEPLOY_SERVICE must hide this one.
const OTHER_VERSION = 'oth-9.9.9';
const OTHER_SERVICE = 'deploy_markers_other_e2e';
const OTHER_VERSION_AGO_MS = 29 * 60 * 1000;

/** Seed releases for two services into the shared logs table. */
async function seedReleases(): Promise<void> {
  const row = (agoMs: number, version: string, service: string) => {
    // Timestamp is written in nanoseconds; TimestampTime is a DEFAULT column.
    const timestampNs = (Date.now() - agoMs) * 1_000_000;
    return (
      `('${timestampNs}', '', '', 0, 'info', 0, ` +
      `'${service}', 'release ${version}', '', ` +
      `{'service.name':'${service}','service.version':'${version}'}, ` +
      `'', '', '', {}, {})`
    );
  };

  const values = [
    row(OLD_VERSION_AGO_MS, OLD_VERSION, DEPLOY_SERVICE),
    row(NEW_VERSION_AGO_MS, NEW_VERSION, DEPLOY_SERVICE),
    row(OTHER_VERSION_AGO_MS, OTHER_VERSION, OTHER_SERVICE),
  ].join(', ');

  await clickhouseQuery(`
    INSERT INTO ${E2E_CLICKHOUSE_DATABASE}.${E2E_LOGS_TABLE} (
      Timestamp, TraceId, SpanId, TraceFlags, SeverityText, SeverityNumber,
      ServiceName, Body, ResourceSchemaUrl, ResourceAttributes, ScopeSchemaUrl,
      ScopeName, ScopeVersion, ScopeAttributes, LogAttributes
    ) VALUES ${values}
  `);
}

test.describe(
  'Deployment markers',
  { tag: ['@full-stack', '@dashboard'] },
  () => {
    let dashboardPage: DashboardPage;

    test.beforeEach(async ({ page }) => {
      dashboardPage = new DashboardPage(page);
      await dashboardPage.goto();
    });

    test('overlays a labelled marker per release and clears them when toggled off', async ({
      page,
    }) => {
      await seedReleases();

      await dashboardPage.createNewDashboard();
      await dashboardPage.addTileWithSource(
        'Deployment markers chart',
        DEFAULT_LOGS_SOURCE_NAME,
      );
      // Scope the chart to one service so its releases are attributable — see
      // the suppression test below for why that matters.
      await dashboardPage.setGlobalFilter(`ServiceName:"${DEPLOY_SERVICE}"`);

      const markers = dashboardPage.getAnnotationMarkers();
      const labels = dashboardPage.getAnnotationLabels();
      await expect(markers).toHaveCount(0);

      await dashboardPage.toggleDeployAnnotations();

      // Ephemeral view state, carried in the URL so a shared link keeps it.
      await expect(page).toHaveURL(/deployMarkers=true/);

      // Both releases first appear inside the window and are far enough apart
      // to stay individually labelled rather than collapsing.
      await expect(markers).toHaveCount(2);
      await expect(labels.filter({ hasText: OLD_VERSION })).toBeVisible();
      await expect(labels.filter({ hasText: NEW_VERSION })).toBeVisible();

      // Regression: markers used to be read from the source globally, so a
      // chart filtered to one service was still annotated with every other
      // service's releases.
      await expect(labels.filter({ hasText: OTHER_VERSION })).toHaveCount(0);

      await dashboardPage.toggleDeployAnnotations();

      await expect(markers).toHaveCount(0);
      await expect(page).not.toHaveURL(/deployMarkers=true/);
    });

    // A marker only aids correlation if the reader can tie it to something on
    // the chart. An aggregate line over several services can't do that, so
    // rather than draw a wall of markers naming services with no visible line,
    // none are drawn at all.
    test('suppresses markers it cannot attribute to the chart', async ({
      page,
    }) => {
      await seedReleases();

      await dashboardPage.createNewDashboard();
      // No filter and no group by: one line covering both seeded services.
      await dashboardPage.addTileWithSource(
        'Unattributable markers',
        DEFAULT_LOGS_SOURCE_NAME,
      );
      await dashboardPage.toggleDeployAnnotations();

      await expect(page).toHaveURL(/deployMarkers=true/);
      // The releases are found by the query — they just aren't drawn, because
      // neither service has its own line here.
      await expect(dashboardPage.getAnnotationMarkers()).toHaveCount(0);
    });
  },
);
