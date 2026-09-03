import { SearchPage } from '../../page-objects/SearchPage';
import { CUSTOM_SERVICE_LOGS_APP_NAMES } from '../../seed-clickhouse';
import { expect, test } from '../../utils/base-test';
import {
  CUSTOM_SERVICE_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from '../../utils/constants';

// The seeded AppName values are distinct tokens that never appear in a Body, so
// matching any of them in the Service column proves it is populated with the
// service and not accidentally reading another column.
const APP_NAME_PATTERN = new RegExp(CUSTOM_SERVICE_LOGS_APP_NAMES.join('|'));

// The seeded trace StatusCode values. Trace sources have no severity text, so
// these are what the Level column has to fall back to.
const TRACE_STATUS_CODE_PATTERN = /STATUS_CODE_(OK|ERROR)/;

test.describe('Event Patterns', { tag: ['@full-stack', '@search'] }, () => {
  test('renders the service name for a non-standard service column that is not in the sort key', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.selectSource(CUSTOM_SERVICE_LOGS_SOURCE_NAME);
    await searchPage.timePicker.selectRelativeTime('Last 1 hour');
    await searchPage.table.waitForRowsToPopulate();
    await expect(searchPage.getTableError()).toHaveCount(0);

    await searchPage.switchToEventPatterns();
    await searchPage.openFirstPattern();

    const panel = searchPage.patternSidePanel;
    await expect(panel.sampleTable).toBeVisible();
    await expect(panel.serviceColumnHeader).toBeVisible();
    await expect(panel.serviceCell(0)).toHaveText(APP_NAME_PATTERN);
  });

  test('falls back to the trace status code in the Level column', async ({
    page,
  }) => {
    const searchPage = new SearchPage(page);
    await searchPage.goto();
    await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
    await searchPage.timePicker.selectRelativeTime('Last 1 hour');
    await searchPage.table.waitForRowsToPopulate();
    await expect(searchPage.getTableError()).toHaveCount(0);

    await searchPage.switchToEventPatterns();
    await expect(searchPage.patternListLevelCell(0)).toHaveText(
      TRACE_STATUS_CODE_PATTERN,
    );

    await searchPage.openFirstPattern();

    const panel = searchPage.patternSidePanel;
    await expect(panel.levelColumnHeader).toBeVisible();
    await expect(panel.levelCell(0)).toHaveText(TRACE_STATUS_CODE_PATTERN);
  });
});
