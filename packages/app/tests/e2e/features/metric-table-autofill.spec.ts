/**
 * Metric table autofill — E2E tests.
 *
 * The metrics source form auto-detects metric tables by matching table-name
 * suffixes in the selected database. Autofill is meant to be a reaction to
 * picking a database: it should run for a new source and whenever the database
 * selection changes, but never when a saved metrics source is opened —
 * otherwise the form silently gains unsaved changes the user never made.
 *
 * Two databases back these tests (see `seed-clickhouse.ts`):
 *   - `default`          — e2e_otel_metrics_gauge / e2e_otel_metrics_sum
 *   - `e2e_metrics_alt`  — alt_otel_metrics_gauge / alt_otel_metrics_sum
 *
 * The distinct table names let an assertion prove which database a detected
 * table came from.
 *
 * Sources are created through the API per test (and deleted afterwards) so the
 * shared 'E2E Metrics' fixture is never mutated, and the forms are always
 * closed without saving.
 */
import type { Page } from '@playwright/test';

import { SourceFormComponent } from '../components/SourceFormComponent';
import { SearchPage } from '../page-objects/SearchPage';
import { getApiUrl, getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_METRICS_SOURCE_NAME,
  E2E_ALT_METRICS_DATABASE,
  E2E_ALT_METRICS_SUM_TABLE,
  E2E_CLICKHOUSE_DATABASE,
  E2E_METRICS_GAUGE_TABLE,
  E2E_METRICS_SUM_TABLE,
} from '../utils/constants';

test.describe(
  'Metric Table Autofill',
  { tag: ['@full-stack', '@sources'] },
  () => {
    /**
     * Creates a metrics source with only its gauge table configured, so
     * autofill has something left to fill in (the sum table) and any autofill
     * on open would be visible as an unsaved change.
     */
    async function createPartiallyConfiguredMetricSource(
      page: Page,
      name: string,
    ): Promise<string> {
      const metricSources = await getSources(page, 'metric');
      const existing = metricSources.find(
        (s: any) => s.name === DEFAULT_METRICS_SOURCE_NAME,
      );
      expect(existing).toBeDefined();

      const createResponse = await page.request.post(`${getApiUrl()}/sources`, {
        data: {
          kind: 'metric',
          name,
          connection: existing.connection,
          from: {
            databaseName: E2E_CLICKHOUSE_DATABASE,
            tableName: '',
          },
          timestampValueExpression: existing.timestampValueExpression,
          resourceAttributesExpression: existing.resourceAttributesExpression,
          // Gauge only — sum is deliberately left unset.
          metricTables: { gauge: E2E_METRICS_GAUGE_TABLE },
        },
      });
      expect(createResponse.ok()).toBeTruthy();
      const created = await createResponse.json();
      return created._id;
    }

    test('autofills metric tables for a new source', async ({ page }) => {
      const searchPage = new SearchPage(page);
      const sourceForm = new SourceFormComponent(page);

      await searchPage.goto();
      await searchPage.sourceActionsMenu.click();
      await searchPage.createNewSourceItem.click();

      // Switching the kind to OTEL Metrics renders the metric table selects for
      // the default database, which is what autofill reacts to.
      await sourceForm.selectSourceKind('OTEL Metrics');

      await sourceForm.waitForMetricTableAutofill();
      await expect(sourceForm.getMetricTableInput('gauge')).toHaveValue(
        E2E_METRICS_GAUGE_TABLE,
      );
      await expect(sourceForm.getMetricTableInput('sum')).toHaveValue(
        E2E_METRICS_SUM_TABLE,
      );

      // Discard the new source without creating it.
      await page.keyboard.press('Escape');
    });

    test('does not autofill when opening a saved metrics source', async ({
      page,
    }) => {
      const sourceForm = new SourceFormComponent(page);
      const sourceName = `E2E Metrics Autofill Open ${Date.now()}`;
      let sourceId = '';

      try {
        sourceId = await createPartiallyConfiguredMetricSource(
          page,
          sourceName,
        );

        // Opening `/team#source-<id>` expands that source's form inline.
        await page.goto(`/team#source-${sourceId}`);
        await expect(sourceForm.nameInput).toHaveValue(sourceName);
        await expect(sourceForm.getMetricTableInput('gauge')).toHaveValue(
          E2E_METRICS_GAUGE_TABLE,
        );

        // The default database has a matching sum table, but merely opening the
        // source must leave the form exactly as saved.
        await sourceForm.expectNoMetricTableAutofill();
        await expect(sourceForm.getMetricTableInput('sum')).toHaveValue('');
      } finally {
        await page.request.delete(`${getApiUrl()}/sources/${sourceId}`);
      }
    });

    test('autofills when the database changes on a saved metrics source', async ({
      page,
    }) => {
      const sourceForm = new SourceFormComponent(page);
      const sourceName = `E2E Metrics Autofill Switch ${Date.now()}`;
      let sourceId = '';

      try {
        sourceId = await createPartiallyConfiguredMetricSource(
          page,
          sourceName,
        );

        await page.goto(`/team#source-${sourceId}`);
        await expect(sourceForm.nameInput).toHaveValue(sourceName);
        await expect(sourceForm.getMetricTableInput('gauge')).toHaveValue(
          E2E_METRICS_GAUGE_TABLE,
        );
        await sourceForm.expectNoMetricTableAutofill();

        // Changing the database is the user action autofill should react to.
        await sourceForm.selectDatabase(E2E_ALT_METRICS_DATABASE);

        await sourceForm.waitForMetricTableAutofill();
        // The detected table comes from the newly selected database. The gauge
        // table the user had already configured is never overwritten.
        await expect(sourceForm.getMetricTableInput('sum')).toHaveValue(
          E2E_ALT_METRICS_SUM_TABLE,
        );
        await expect(sourceForm.getMetricTableInput('gauge')).toHaveValue(
          E2E_METRICS_GAUGE_TABLE,
        );
      } finally {
        await page.request.delete(`${getApiUrl()}/sources/${sourceId}`);
      }
    });
  },
);
