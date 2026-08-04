import { SourceFormComponent } from '../components/SourceFormComponent';
import { SearchPage } from '../page-objects/SearchPage';
import { getApiUrl, getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_SESSIONS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
  E2E_METRICS_GAUGE_TABLE,
  E2E_METRICS_SUM_TABLE,
  METADATA_MV_LOGS_SOURCE_NAME,
  PARTIAL_METRICS_SOURCE_NAME,
} from '../utils/constants';
import { setTeamFlag } from '../utils/db-helpers';

const COMMON_FIELDS = [
  'Name',
  'Source Data Type',
  'Server Connection',
  'Database',
  'Table',
];

const LOG_FIELDS = [
  ...COMMON_FIELDS,
  'Service Name Expression',
  'Log Level Expression',
  'Body Expression',
  'Log Attributes Expression',
  'Resource Attributes Expression',
  'Displayed Timestamp Column',
  'Correlated Metric Source',
  'Correlated Trace Source',
  'Trace Id Expression',
  'Span Id Expression',
  'Implicit Column Expression',
  'Default Order By',
];

const TRACE_FIELDS = [
  ...COMMON_FIELDS,
  'Duration Expression',
  'Duration Precision',
  'Trace Id Expression',
  'Span Id Expression',
  'Parent Span Id Expression',
  'Span Name Expression',
  'Span Kind Expression',
  'Correlated Log Source',
  'Correlated Session Source',
  'Correlated Metric Source',
  'Status Code Expression',
  'Status Message Expression',
  'Service Name Expression',
  'Resource Attributes Expression',
  'Event Attributes Expression',
  'Span Events Expression',
  'Implicit Column Expression',
  'Displayed Timestamp Column',
  'Default Order By',
];

const SESSION_FIELDS = [...COMMON_FIELDS, 'Correlated Trace Source'];

// Note: `series Table` is intentionally excluded here — it's
// only rendered when the team's `isMetricsSeriesTableEnabled` flag is on, which is
// off by default. See "should show series Table field when isMetricsSeriesTableEnabled
// is on" below for the flag-enabled case.
const METRIC_FIELDS = [
  ...COMMON_FIELDS.slice(0, -1), // Remove Table
  'gauge Table',
  'histogram Table',
  'sum Table',
  'summary Table',
  'exponential histogram Table',
  'Correlated Log Source',
];

const editableSourcesData = [
  {
    name: DEFAULT_LOGS_SOURCE_NAME,
    fields: LOG_FIELDS,
    radioButtonName: 'Log',
  },
  {
    name: DEFAULT_TRACES_SOURCE_NAME,
    fields: TRACE_FIELDS,
    radioButtonName: 'Trace',
  },
];

const allSourcesData = [
  ...editableSourcesData,
  {
    name: DEFAULT_METRICS_SOURCE_NAME,
    fields: METRIC_FIELDS,
    radioButtonName: 'OTEL Metrics',
  },
  {
    name: DEFAULT_SESSIONS_SOURCE_NAME,
    fields: SESSION_FIELDS,
    radioButtonName: 'Session',
  },
];

test.describe('Sources Functionality', { tag: ['@sources'] }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('should show source actions in kebab menu', async () => {
    // Open the source-actions kebab menu next to the source picker.
    await searchPage.sourceActionsMenu.click();

    // Per-source and create actions are always wired.
    await expect(searchPage.editSourceItem).toBeVisible();
    await expect(searchPage.createNewSourceItem).toBeVisible();

    // `Manage sources` is wired only in non-local (full-stack) mode.
    if (process.env.E2E_FULLSTACK === 'true') {
      await expect(searchPage.manageSourcesItem).toBeVisible();
    } else {
      await expect(searchPage.manageSourcesItem).toHaveCount(0);
    }
  });

  test(
    'should show the correct source form when modal is open',
    { tag: ['@sources'] },
    async () => {
      test.skip(
        process.env.E2E_FULLSTACK === 'true',
        'Skipping source form tests in fullstack mode due to UI differences',
      );
      for (const sourceData of editableSourcesData) {
        await test.step(`Verify ${sourceData.name} fields`, async () => {
          // Demo Logs is selected by default, so we don't need to select it again
          if (sourceData.name !== 'Demo Logs') {
            await searchPage.selectSource(sourceData.name);
          }
          await searchPage.openEditSourceModal();
          await searchPage.sourceModalShowOptionalFields();

          for (const field of sourceData.fields) {
            await expect(
              searchPage.page.getByText(field, { exact: true }),
            ).toBeVisible();
          }

          // press escape to close the modal
          await searchPage.page.keyboard.press('Escape');
        });
      }
    },
  );

  test('should show proper fields when creating a new source', async () => {
    await searchPage.sourceActionsMenu.click();
    await searchPage.createNewSourceItem.click();
    // for each source type (log, trace, session, metric), verify the correct fields are shown
    for (const sourceData of allSourcesData) {
      await test.step(`Verify ${sourceData.radioButtonName} source type`, async () => {
        // Find the radio button by its label
        const radioButton = searchPage.page.getByLabel(
          sourceData.radioButtonName,
          { exact: true },
        );

        // Click the radio button
        await radioButton.click();

        // Show optional fields if the button exists
        await searchPage.sourceModalShowOptionalFields();

        // Verify fields
        for (const field of sourceData.fields) {
          await expect(
            searchPage.page.getByText(field, { exact: true }),
          ).toBeVisible();
        }
      });
    }
    await searchPage.page.keyboard.press('Escape');
  });

  test(
    'should persist custom ORDER BY and return search results',
    { tag: ['@full-stack'] },
    async ({ page }) => {
      const API_URL = getApiUrl();
      const logSources = await getSources(page, 'log');
      const source = logSources.find(
        (s: any) => s.name === DEFAULT_LOGS_SOURCE_NAME,
      );
      expect(source).toBeDefined();

      const sourceId = source._id;
      const customOrderBy = 'Timestamp ASC';

      try {
        await test.step('Set custom orderByExpression on the source', async () => {
          const updateResponse = await page.request.put(
            `${API_URL}/sources/${sourceId}`,
            {
              data: {
                ...source,
                id: sourceId,
                orderByExpression: customOrderBy,
              },
            },
          );
          expect(updateResponse.ok()).toBeTruthy();
        });

        await test.step('Verify orderByExpression is persisted', async () => {
          const updatedSources = await getSources(page, 'log');
          const updatedSource = updatedSources.find(
            (s: any) => s._id === sourceId,
          );
          expect(updatedSource).toBeDefined();
          expect(updatedSource.orderByExpression).toBe(customOrderBy);
        });

        await test.step('Verify search results load with custom ORDER BY', async () => {
          await searchPage.goto();
          await searchPage.selectSource(source.name);
          await searchPage.submitEmptySearch();
          await expect(searchPage.table.firstRow).toBeVisible();
        });
      } finally {
        await page.request.put(`${API_URL}/sources/${sourceId}`, {
          data: {
            ...source,
            id: sourceId,
            orderByExpression: '',
          },
        });
      }
    },
  );

  test(
    'auto-infers and populates metric tables for a brand new source',
    { tag: ['@full-stack'] },
    async ({ page }) => {
      const sourceForm = new SourceFormComponent(page);

      // Open the "Configure New Source" modal and switch to the metrics kind.
      await searchPage.openCreateSourceModal();
      await searchPage.selectSourceKind('OTEL Metrics');

      // A brand-new source has no metric tables, so once the default
      // database's table list loads the form should infer and auto-populate
      // the metric tables it recognizes. The gauge and sum tables exist in
      // the seeded E2E ClickHouse database, so both get filled in.
      await sourceForm.waitForMetricAutoDetectSuccess();

      await expect(sourceForm.getMetricTableInput('gauge')).toHaveValue(
        E2E_METRICS_GAUGE_TABLE,
      );
      await expect(sourceForm.getMetricTableInput('sum')).toHaveValue(
        E2E_METRICS_SUM_TABLE,
      );

      // Close without saving to avoid persisting a throwaway source.
      await page.keyboard.press('Escape');
    },
  );

  test(
    'does not infer missing metric tables when editing a source that already has tables',
    { tag: ['@full-stack'] },
    async ({ page }) => {
      const sourceForm = new SourceFormComponent(page);

      // 'E2E Metrics Partial' is saved with only the gauge table configured;
      // sum (and the rest) are intentionally left empty.
      await searchPage.selectSource(PARTIAL_METRICS_SOURCE_NAME);
      await searchPage.openEditSourceModal();

      // Form hydrates from the saved source: gauge is set, sum is empty.
      await expect(sourceForm.getMetricTableInput('gauge')).toHaveValue(
        E2E_METRICS_GAUGE_TABLE,
      );
      await expect(sourceForm.getMetricTableInput('sum')).toHaveValue('');

      // Open the sum dropdown to confirm the ClickHouse table list has loaded
      // and that the sum table IS a valid inference candidate — i.e. without
      // the guard the form WOULD auto-fill it. (Clicking also waits for the
      // select to become enabled once tables have loaded.)
      await sourceForm.openMetricTableDropdown('sum');
      await expect(
        sourceForm.getTableOption(E2E_METRICS_SUM_TABLE),
      ).toBeVisible();
      await page.keyboard.press('Escape');

      // The guard suppresses inference for a source that already has tables:
      // no auto-detect notification fires and the sum table stays unset,
      // making the "unsaved/missing" state visible instead of silently
      // filling it in.
      await expect(sourceForm.getMetricAutoDetectNotification()).toHaveCount(0);
      await expect(sourceForm.getMetricTableInput('sum')).toHaveValue('');
    },
  );

  test(
    'source form sends the complete source on update (no field omission)',
    { tag: ['@full-stack'] },
    async ({ page }) => {
      // Pins the contract that updateSource relies on: saving from the
      // source form must not drop any populated field. The controller
      // uses findOneAndReplace, so any field omitted from the PUT body
      // is silently deleted from MongoDB. If the frontend ever moves
      // to a partial/PATCH-style payload, this test will fail because
      // the before/after diff will show fields disappearing.
      //
      // METADATA_MV_LOGS has the broadest field coverage in fixtures,
      // including metadataMaterializedViews — the field whose deletion
      // bug motivated the controller change.
      const logSources = await getSources(page, 'log');
      const sourceBefore = logSources.find(
        (s: any) => s.name === METADATA_MV_LOGS_SOURCE_NAME,
      );
      expect(sourceBefore).toBeDefined();
      expect(sourceBefore.metadataMaterializedViews).toBeDefined();
      const sourceId = sourceBefore._id;

      await searchPage.selectSource(METADATA_MV_LOGS_SOURCE_NAME);
      await searchPage.openEditSourceModal();

      // Gate on form hydration to avoid racing Save against
      // react-hook-form's `values` reset. In full-stack mode "Edit
      // source" navigates to /team and expands the source's
      // TableSourceForm inline (no modal), so we scope by input name.
      await expect(page.locator('input[name="name"]')).toHaveValue(
        METADATA_MV_LOGS_SOURCE_NAME,
      );

      const putResponsePromise = page.waitForResponse(
        res =>
          res.url().includes(`/sources/${sourceId}`) &&
          res.request().method() === 'PUT',
      );
      await searchPage.saveSourceForm();

      // The seeded source sets implicitColumnExpression without
      // bodyExpression, which triggers the pairing-warnings dialog.
      // The PUT only fires after the user confirms via "Save anyway".
      await page.getByRole('button', { name: 'Save anyway' }).click();

      const putResponse = await putResponsePromise;
      expect(putResponse.ok()).toBeTruthy();

      const sourcesAfter = await getSources(page, 'log');
      const sourceAfter = sourcesAfter.find((s: any) => s._id === sourceId);
      expect(sourceAfter).toBeDefined();

      // Specific regression: metadataMaterializedViews survived the
      // form roundtrip with its user-meaningful fields intact. The
      // embedded sub-document gets a fresh Mongoose-minted _id on
      // each findOneAndReplace, which is fine — we only care that
      // the rollup config the user configured is preserved.
      expect(sourceAfter.metadataMaterializedViews).toMatchObject({
        keyRollupTable: sourceBefore.metadataMaterializedViews.keyRollupTable,
        kvRollupTable: sourceBefore.metadataMaterializedViews.kvRollupTable,
        granularity: sourceBefore.metadataMaterializedViews.granularity,
      });

      // Broader contract: every populated field present before the save
      // is still present after the save. Server-managed bookkeeping
      // fields are expected to differ (timestamps, version) or stay
      // pinned (_id, team) on their own schedule.
      const serverManagedKeys = new Set([
        '_id',
        '__v',
        'team',
        'createdAt',
        'updatedAt',
      ]);
      for (const key of Object.keys(sourceBefore)) {
        if (serverManagedKeys.has(key)) continue;
        if (sourceBefore[key] == null) continue;
        expect(sourceAfter).toHaveProperty(key);
      }
    },
  );

  // These two tests both flip the shared team's `isMetricsSeriesTableEnabled`
  // flag. There's no settings UI or API endpoint for team feature flags yet,
  // so it's toggled directly in Mongo (see utils/db-helpers.ts) — and this
  // app only ever supports a single team per deployment (`/register/
  // password` 409s with `teamAlreadyExists` once any team exists, even in
  // full-stack mode — see `isTeamExisting` in
  // packages/api/src/controllers/team.ts), so there's no way to give them
  // their own isolated team to avoid racing each other. `fullyParallel:
  // true` means tests in the same file can otherwise run concurrently
  // across workers, so this block is pinned to `serial` mode to keep the
  // two flag flips from interleaving. Any future test that also mutates
  // this flag should join this block.
  test.describe.serial('isMetricsSeriesTableEnabled', () => {
    test(
      'should show series Table field when isMetricsSeriesTableEnabled is on',
      { tag: ['@full-stack'] },
      async () => {
        setTeamFlag('isMetricsSeriesTableEnabled', true);
        try {
          await searchPage.goto();
          await searchPage.sourceActionsMenu.click();
          await searchPage.createNewSourceItem.click();

          await searchPage.page
            .getByLabel('OTEL Metrics', { exact: true })
            .click();
          await searchPage.sourceModalShowOptionalFields();

          await expect(
            searchPage.page.getByText('series Table', { exact: true }),
          ).toBeVisible();

          await searchPage.page.keyboard.press('Escape');
        } finally {
          setTeamFlag('isMetricsSeriesTableEnabled', false);
        }
      },
    );

    test(
      'should warn when the configured series table does not match the series table schema',
      { tag: ['@full-stack'] },
      async ({ page }) => {
        setTeamFlag('isMetricsSeriesTableEnabled', true);

        const API_URL = getApiUrl();
        const metricSources = await getSources(page, 'metric');
        const existing = metricSources.find(
          (s: any) => s.name === DEFAULT_METRICS_SOURCE_NAME,
        );
        expect(existing).toBeDefined();

        // A minimal, isolated source (rather than editing the shared,
        // heavily configured E2E Metrics fixture) so opening the edit form
        // only fires the column checks this test cares about.
        const newSourceName = 'E2E Metrics Series Check';
        let createdSourceId = '';

        try {
          // e2e_otel_metrics_gauge is a real table but doesn't have the
          // Date/SeriesHash/MetricType/etc. columns the series table
          // requires, so it should be reported as an invalid series table.
          const createResponse = await page.request.post(`${API_URL}/sources`, {
            data: {
              kind: 'metric',
              name: newSourceName,
              connection: existing.connection,
              from: existing.from,
              timestampValueExpression: existing.timestampValueExpression,
              resourceAttributesExpression:
                existing.resourceAttributesExpression,
              metricTables: {
                gauge: E2E_METRICS_GAUGE_TABLE,
              },
              seriesTable: E2E_METRICS_GAUGE_TABLE,
            },
          });
          expect(createResponse.ok()).toBeTruthy();
          const created = await createResponse.json();
          createdSourceId = created._id;

          await page.goto(`/team#source-${createdSourceId}`);
          await searchPage.sourceModalShowOptionalFields();

          await expect(
            page.getByText(
              "This table doesn't match the expected series table schema.",
            ),
          ).toBeVisible({ timeout: 20000 });
        } finally {
          await page.request.delete(`${API_URL}/sources/${createdSourceId}`);
          setTeamFlag('isMetricsSeriesTableEnabled', false);
        }
      },
    );
  });
});
