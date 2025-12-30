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
        await searchPage.savedSearchModal.saveSearch('Custom Select Search');

        await expect(searchPage.savedSearchModal.container).toBeHidden();
        await page.waitForURL(/\/search\/[a-f0-9]+/, { timeout: 5000 });
      });

      const savedSearchAUrl = page.url().split('?')[0];

      await test.step('Create second saved search with default SELECT', async () => {
        await searchPage.goto();

        // Keep default SELECT (don't modify it)
        await searchPage.submitEmptySearch();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearch('Default Select Search');

        await expect(searchPage.savedSearchModal.container).toBeHidden();
        await page.waitForURL(/\/search\/[a-f0-9]+/, { timeout: 10000 });
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
        await searchPage.savedSearchModal.saveSearch(
          'Custom Select Source Test',
        );

        await expect(searchPage.savedSearchModal.container).toBeHidden();
        await page.waitForURL(/\/search\/[a-f0-9]+/, { timeout: 5000 });
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
      let originalSourceName: string | null = null;

      await test.step('Create and navigate to saved search', async () => {
        const customSelect =
          'Timestamp, Body, lower(ServiceName) as service_name';
        await searchPage.setCustomSELECT(customSelect);
        await searchPage.submitEmptySearch();
        await searchPage.openSaveSearchModal();
        await searchPage.savedSearchModal.saveSearch('Source Switching Test');

        await expect(searchPage.savedSearchModal.container).toBeHidden();
        await page.waitForURL(/\/search\/[a-f0-9]+/, { timeout: 5000 });
      });

      await test.step('Switch to different source via dropdown', async () => {
        originalSourceName = await searchPage.currentSource.inputValue();

        await searchPage.sourceDropdown.click();
        await searchPage.otherSources.first().click();
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
        await page
          .getByRole('option', {
            name: originalSourceName || '',
            exact: true,
          })
          .click();
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
});
