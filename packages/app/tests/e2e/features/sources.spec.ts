import { SearchPage } from '../page-objects/SearchPage';
import { expect, test } from '../utils/base-test';

const commonFields = [
  'Name',
  'Source Data Type',
  'Server Connection',
  'Database',
  'Table',
];
const logFields = [
  ...commonFields,
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
];

const traceFields = [
  ...commonFields,
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
];

const sessionFields = [...commonFields, 'Correlated Trace Source'];

const metricFields = [
  ...commonFields.slice(0, -1), // Remove Table
  'Gauge Table',
  'Histogram Table',
  'Sum Table',
  'Summary Table',
  'Exponential Histogram Table',
  'Correlated Log Source',
];

const sourcesData = [
  { name: 'Demo Logs', fields: logFields },
  { name: 'Demo Traces', fields: traceFields },
  { name: 'Demo Sessions', fields: sessionFields },
  { name: 'Demo Metrics', fields: metricFields },
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
    await expect(searchPage.editSourceItems.first()).toBeVisible();
  });

  test(
    'should show the correct source form when modal is open',
    { tag: ['@sources'] },
    async () => {
      for (const sourceData of sourcesData) {
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
});
