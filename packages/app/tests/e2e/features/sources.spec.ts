import { SearchPage } from '../page-objects/SearchPage';
import { getApiUrl, getSources } from '../utils/api-helpers';
import { expect, test } from '../utils/base-test';
import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_METRICS_SOURCE_NAME,
  DEFAULT_SESSIONS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
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

  test('should open source settings menu', async () => {
    // Click source settings menu
    await searchPage.sourceMenu.click();

    // Verify create new source menu item is visible
    await expect(searchPage.createNewSourceItem).toBeVisible();

    // Verify edit source menu items are visible
    await expect(searchPage.editSourceMenuItem).toBeVisible();
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
    await searchPage.sourceMenu.click();
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
      expect(logSources.length).toBeGreaterThan(0);

      const source = logSources[0];
      const sourceId = source._id;
      const customOrderBy = 'Timestamp ASC';

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

      await test.step('Clean up: reset orderByExpression', async () => {
        const resetResponse = await page.request.put(
          `${API_URL}/sources/${sourceId}`,
          {
            data: {
              ...source,
              id: sourceId,
              orderByExpression: '',
            },
          },
        );
        expect(resetResponse.ok()).toBeTruthy();
      });
    },
  );
});
