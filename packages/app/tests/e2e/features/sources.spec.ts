import { SearchPage } from '../page-objects/SearchPage';
import { getApiUrl, getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_SESSIONS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
  METADATA_MV_LOGS_SOURCE_NAME,
} from '../utils/constants';

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
});
