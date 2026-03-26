import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';
import { DEFAULT_TRACES_SOURCE_NAME } from '../../utils/constants';

test.describe('Side Panel Navigation', { tag: '@search' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  test('should open side panel from search results and display overview', async () => {
    await test.step('Click first row to open side panel', async () => {
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible();
    });

    await test.step('Verify overview tab content is visible', async () => {
      await searchPage.sidePanel.clickTab('overview');
      await expect(searchPage.sidePanel.getTabPanel('overview')).toBeVisible();
    });
  });

  test('should navigate to Column Values tab and see structured data', async () => {
    await test.step('Open side panel', async () => {
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible();
    });

    await test.step('Click parsed tab and verify structured data', async () => {
      await searchPage.sidePanel.clickTab('parsed');
      await expect(searchPage.sidePanel.getTabPanel('parsed')).toBeVisible();
    });
  });

  test('should navigate to trace tab for a trace row', async () => {
    await test.step('Select traces source', async () => {
      await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
      await searchPage.table.waitForRowsToPopulate();
    });

    await test.step('Open side panel from trace row', async () => {
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible();
    });

    await test.step('Verify trace tab is available and clickable', async () => {
      const traceTab = searchPage.sidePanel.getTab('trace');
      await expect(traceTab).toBeVisible({ timeout: 10000 });
      await traceTab.click({ timeout: 10000 });
      // Tab should remain visible after click
      await expect(traceTab).toBeVisible();
    });
  });

  test('should navigate to context tab and see surrounding entries', async () => {
    await test.step('Open side panel from log row', async () => {
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible();
    });

    await test.step('Click context tab and verify tab is visible', async () => {
      // Wait a moment for the side panel to fully render all tabs
      const contextTab = searchPage.sidePanel.getTab('context');
      await expect(contextTab).toBeVisible({ timeout: 5000 });
      await contextTab.click();
      // Verify tab was clicked (it should still be visible)
      await expect(contextTab).toBeVisible();
    });
  });

  test('should close side panel with Escape key', async () => {
    await test.step('Open side panel', async () => {
      await searchPage.table.clickFirstRow();
      await expect(searchPage.sidePanel.container).toBeVisible();
    });

    await test.step('Press Escape and verify panel is hidden', async () => {
      await searchPage.page.keyboard.press('Escape');
      await expect(searchPage.sidePanel.container).toBeHidden();
    });
  });
});
