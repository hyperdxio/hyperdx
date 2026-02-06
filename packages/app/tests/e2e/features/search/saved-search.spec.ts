import {
  DEFAULT_LOGS_SOURCE_NAME,
  DEFAULT_TRACES_SOURCE_NAME,
} from 'tests/e2e/utils/constants';

import { SearchPage } from '../../page-objects/SearchPage';
import { expect, test } from '../../utils/base-test';

test.describe('Saved Search Functionality', { tag: '@full-stack' }, () => {
  let searchPage: SearchPage;

  test.beforeEach(async ({ page }) => {
    searchPage = new SearchPage(page);
    await searchPage.goto();
  });

  // TODO: Expand this test to include:
  // - Add tags
  // - Verify search appears in sidebar

  test(
    'should preserve custom SELECT when navigating between saved searches',
    { tag: '@full-stack' },
    async ({ page }) => {
      /**
       * This test verifies the fix for issue where SELECT statement would not
       * update correctly when switching between saved searches.
       *
       * Reproduction steps:
       * 1. Create saved search A with custom SELECT (e.g. Timestamp, Body, CustomField)
       * 2. Navigate to saved search B with default SELECT
       * 3. Navigate back to saved search A
       * 4. Verify SELECT statement shows custom columns, not default
       */

      await test.step('Create first saved search with custom SELECT', async () => {
        const customSelect =
          'Timestamp, Body, upper(ServiceName) as service_name';
        await searchPage.setCustomSELECT(customSelect);
        await searchPage.submitEmptySearch();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          'Custom Select Search',
        );
      });

      const savedSearchAUrl = page.url().split('?')[0];

      await test.step('Create second saved search with default SELECT', async () => {
        await searchPage.goto();

        // Keep default SELECT (don't modify it)
        await searchPage.submitEmptySearch();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          'Default Select Search',
        );
      });

      await test.step('Navigate back to first saved search', async () => {
        await page.goto(savedSearchAUrl);
        await searchPage.table.waitForRowsToPopulate();
      });

      await test.step('Verify custom SELECT is preserved', async () => {
        const selectEditor = searchPage.getSELECTEditor();
        const selectContent = await selectEditor.textContent();

        expect(selectContent).toContain('upper(ServiceName) as service_name');
      });
    },
  );

  test(
    'should restore saved search SELECT after switching sources',
    { tag: '@full-stack' },
    async ({ page }) => {
      /**
       * This test verifies that SELECT properly updates when switching between
       * sources and saved searches.
       *
       * Test flow:
       * 1. Create saved search with custom SELECT on Source A
       * 2. Switch to Source B (should show Source B's default SELECT)
       * 3. Switch back to Source A (should restore saved search's custom SELECT)
       */

      await test.step('Create saved search with custom SELECT', async () => {
        const customSelect = 'Timestamp, Body, lower(Body) as body_lower';
        await searchPage.setCustomSELECT(customSelect);
        await searchPage.submitEmptySearch();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          'Custom Select Source Test',
        );
      });

      const savedSearchUrl = page.url().split('?')[0];

      await test.step('Switch to a different source', async () => {
        await searchPage.sourceDropdown.click();
        await searchPage.otherSources.nth(0).click();
        await page.waitForLoadState('networkidle');
        await searchPage.table.waitForRowsToPopulate();
      });

      await test.step('Verify different source has its own default SELECT', async () => {
        const selectEditor = searchPage.getSELECTEditor();
        const selectContent = await selectEditor.textContent();

        expect(selectContent).not.toContain('lower(Body) as body_lower');
        expect(selectContent).toMatch(/Timestamp/i);
      });

      await test.step('Navigate back to saved search', async () => {
        await page.goto(savedSearchUrl);
        await searchPage.table.waitForRowsToPopulate();
      });

      await test.step('Verify saved search SELECT is restored', async () => {
        const selectEditor = searchPage.getSELECTEditor();
        const selectContent = await selectEditor.textContent();

        // Verifies the fix: SELECT restores to saved search's custom value
        expect(selectContent).toContain('lower(Body) as body_lower');
        expect(selectContent).toContain('Timestamp, Body, lower(Body)');
      });
    },
  );

  test(
    'should use default SELECT when switching sources within a saved search',
    { tag: '@full-stack' },
    async ({ page }) => {
      await test.step('Create and navigate to saved search', async () => {
        const customSelect =
          'Timestamp, Body, lower(ServiceName) as service_name';
        await searchPage.setCustomSELECT(customSelect);
        await searchPage.submitEmptySearch();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          'Source Switching Test',
        );
      });

      await test.step('Switch to different source via dropdown', async () => {
        await searchPage.sourceDropdown.click();
        await searchPage.selectSource(DEFAULT_TRACES_SOURCE_NAME);
        await page.waitForLoadState('networkidle');
        await searchPage.table.waitForRowsToPopulate();
      });

      await test.step('Verify SELECT changed to the new source default', async () => {
        const selectEditor = searchPage.getSELECTEditor();
        const selectContent = await selectEditor.textContent();

        expect(selectContent).not.toContain(
          'lower(ServiceName) as service_name',
        );
        expect(selectContent).toMatch(/Timestamp/i);
      });

      await test.step('Switch back to original source via dropdown', async () => {
        await searchPage.sourceDropdown.click();
        await searchPage.selectSource(DEFAULT_LOGS_SOURCE_NAME);
        await page.waitForLoadState('networkidle');
        await searchPage.table.waitForRowsToPopulate();
      });

      await test.step('Verify SELECT is search custom SELECT', async () => {
        const selectEditor = searchPage.getSELECTEditor();
        const selectContent = await selectEditor.textContent();

        expect(selectContent).toContain('lower(ServiceName) as service_name');
      });
    },
  );

  test(
    'should load saved search when navigating from another page',
    { tag: '@full-stack' },
    async ({ page }) => {
      /**
       * This test verifies the fix for the issue where saved searches would not
       * load properly when users navigate to them from another page (e.g., service map).
       *
       * Test flow:
       * 1. Create a saved search with custom configuration (WHERE and ORDER BY)
       * 2. Navigate to a different page (service map)
       * 3. Navigate to the saved search URL
       * 4. Verify saved search loaded correctly with all configuration restored
       */

      let savedSearchUrl: string;
      const customOrderBy = 'ServiceName ASC';

      await test.step('Create a saved search with custom WHERE and ORDER BY', async () => {
        // Set up a custom search with WHERE clause
        // Use SeverityText which is a valid column in the demo data
        await searchPage.performSearch('SeverityText:info');

        // Set custom ORDER BY
        await searchPage.setCustomOrderBy(customOrderBy);

        // Submit the search to ensure configuration is applied
        await searchPage.submitButton.click();
        await searchPage.table.waitForRowsToPopulate();

        // Save the search
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearch(
          'Info Logs Navigation Test',
        );

        // Wait for save to complete and URL to change
        await expect(searchPage.savedSearchModal.container).toBeHidden();
        await page.waitForURL(/\/search\/[a-f0-9]+/, { timeout: 5000 });

        // Capture the saved search URL (without query params)
        savedSearchUrl = page.url().split('?')[0];
      });

      await test.step('Navigate to a different page (service map)', async () => {
        // Navigate to service map page
        await page.goto('/service-map');

        // Wait for service map page to load
        await expect(page.getByTestId('service-map-page')).toBeVisible();
      });

      await test.step('Navigate to saved search from service map', async () => {
        // Navigate directly to the saved search URL (simulating clicking a link)
        await page.goto(savedSearchUrl);

        // Wait for the search page to load
        await expect(page.getByTestId('search-page')).toBeVisible();
      });

      await test.step('Verify saved search loaded and executed automatically', async () => {
        // Verify the WHERE clause is populated
        const whereInput = searchPage.input;
        await expect(whereInput).toHaveValue('SeverityText:info');

        // Verify ORDER BY is restored
        const orderByEditor = searchPage.getOrderByEditor();
        const orderByContent = await orderByEditor.textContent();
        expect(orderByContent).toContain('ServiceName ASC');

        // Verify search results are visible (search executed automatically)
        await searchPage.table.waitForRowsToPopulate();
        const rowCount = await searchPage.table.getRows().count();
        expect(rowCount).toBeGreaterThan(0);

        // Verify the search actually ran (not just showing cached results)
        const resultsTable = searchPage.getSearchResultsTable();
        await expect(resultsTable).toBeVisible();
      });
    },
  );

  test(
    'should preserve custom SELECT when loading saved search from another page',
    { tag: '@full-stack' },
    async ({ page }) => {
      /**
       * This test specifically verifies that custom SELECT statements are preserved
       * when navigating to a saved search from another page.
       */

      let savedSearchUrl: string;
      const customSelect =
        'Timestamp, Body, upper(ServiceName) as service_name';

      await test.step('Create saved search with custom SELECT', async () => {
        await searchPage.setCustomSELECT(customSelect);
        await searchPage.performSearch('ServiceName:frontend');
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          'Custom Select Navigation Test',
        );

        savedSearchUrl = page.url().split('?')[0];
      });

      await test.step('Navigate to dashboards page', async () => {
        await page.goto('/dashboards');
        await expect(page.getByTestId('dashboard-page')).toBeVisible();
      });

      await test.step('Navigate back to saved search', async () => {
        await page.goto(savedSearchUrl);
        await expect(page.getByTestId('search-page')).toBeVisible();
      });

      await test.step('Verify custom SELECT is preserved', async () => {
        // Wait for results to load
        await searchPage.table.waitForRowsToPopulate();

        // Verify SELECT content
        const selectEditor = searchPage.getSELECTEditor();
        const selectContent = await selectEditor.textContent();

        expect(selectContent).toContain('upper(ServiceName) as service_name');
        expect(selectContent).toContain('Timestamp, Body');
      });
    },
  );

  test(
    'should handle navigation via browser back button',
    { tag: '@full-stack' },
    async ({ page }) => {
      /**
       * This test verifies that using browser back/forward navigation
       * properly loads saved searches.
       */

      await test.step('Create and save a search', async () => {
        await searchPage.performSearch('SeverityText:info');
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          'Browser Navigation Test',
        );
      });

      await test.step('Navigate to sessions page', async () => {
        await page.goto('/sessions');
        await expect(page.getByTestId('sessions-page')).toBeVisible();
      });

      await test.step('Use browser back button', async () => {
        await page.goBack();
        await expect(page.getByTestId('search-page')).toBeVisible();
      });

      await test.step('Verify saved search loads correctly after back navigation', async () => {
        // Verify WHERE clause
        const whereInput = searchPage.input;
        await expect(whereInput).toHaveValue('SeverityText:info');

        // Verify results load
        await searchPage.table.waitForRowsToPopulate();
        const rowCount = await searchPage.table.getRows().count();
        expect(rowCount).toBeGreaterThan(0);
      });
    },
  );

  test(
    'should update ORDER BY when switching sources multiple times',
    { tag: '@full-stack' },
    async ({ page }) => {
      /**
       * This test verifies the fix for the issue where ORDER BY does not update
       * correctly after the first source change on saved search pages.
       *
       * Reproduction steps:
       * 1. Create saved search with custom ORDER BY on Source A
       * 2. Switch to Source B (ORDER BY should change to Source B's default)
       * 3. Switch back to Source A (ORDER BY should restore to saved search's custom value)
       */

      let originalSourceName: string | null = null;
      let secondSourceName: string | null = null;
      const thirdSourceName: string | null = null;
      const customOrderBy = 'Body DESC';

      await test.step('Create saved search with custom ORDER BY', async () => {
        originalSourceName = await searchPage.currentSource.inputValue();

        // Set custom ORDER BY
        await searchPage.setCustomOrderBy(customOrderBy);

        // Submit and save the search
        await searchPage.submitEmptySearch();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearchAndWaitForNavigation(
          'ORDER BY Multiple Source Switch Test',
        );
      });

      await test.step('Switch to second source', async () => {
        await searchPage.sourceDropdown.click();
        secondSourceName = await searchPage.otherSources.first().textContent();
        await searchPage.otherSources.first().click();
        await page.waitForLoadState('networkidle');
        await searchPage.table.waitForRowsToPopulate();
      });

      await test.step('Verify ORDER BY changed to second source default', async () => {
        const orderByEditor = searchPage.getOrderByEditor();
        const orderByContent = await orderByEditor.textContent();

        // Should not contain the custom ORDER BY from the saved search

        await expect(orderByEditor).not.toHaveText('Body DESC', {
          timeout: 5000,
        });
        await expect(orderByEditor).toHaveText(/(Timestamp|timestamp)/i, {
          timeout: 5000,
        });
      });

      await test.step('Switch back to original source', async () => {
        await searchPage.sourceDropdown.click();
        await page
          .getByRole('option', {
            name: originalSourceName || '',
            exact: true,
          })
          .click();
        await page.waitForLoadState('networkidle');
        await searchPage.table.waitForRowsToPopulate();
      });

      await test.step('Verify ORDER BY restored to saved search custom value', async () => {
        const orderByEditor = searchPage.getOrderByEditor();
        await expect(orderByEditor).toHaveText('Body DESC', { timeout: 5000 });
      });
    },
  );
});
