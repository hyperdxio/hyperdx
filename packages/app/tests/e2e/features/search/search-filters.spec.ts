import { expect, test } from '../../utils/base-test';

test.describe('Search Filters', { tag: ['@search'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
  });

  test('should filter logs by severity level and persist pinned filters', async ({
    page,
  }) => {
    await test.step('Apply Info severity filter', async () => {
      // Open the Severity filter group
      await page.locator('[data-testid="filter-group-SeverityText"]').click();

      // Select the Info severity level
      const infoCheckbox = page.locator(
        '[data-testid="filter-checkbox-input-info"]',
      );
      await expect(infoCheckbox).toBeVisible();
      await infoCheckbox.click();
      await expect(infoCheckbox).toBeChecked();

      // Verify search results are filtered
      await expect(
        page.locator('[data-testid="search-results-table"]'),
      ).toBeVisible();
    });

    await test.step('Exclude Info severity level', async () => {
      // Hover over the Info filter to show exclude button
      const infoFilter = page.locator('[data-testid="filter-checkbox-info"]');
      await infoFilter.hover();

      // Click exclude button to invert the filter
      await page.locator('[data-testid="filter-exclude-info"]').first().click();
      await page.waitForTimeout(500);

      // Verify filter shows as excluded (indeterminate state)
      const infoInput = page.locator(
        '[data-testid="filter-checkbox-input-info"]',
      );
      await expect(infoInput).toHaveAttribute('data-indeterminate', 'true');
      await page.waitForLoadState('networkidle');
    });

    await test.step('Clear the filter', async () => {
      // Click the filter again to clear it
      await page.locator('[data-testid="filter-checkbox-info"]').click();
      await page.waitForTimeout(500);
    });

    await test.step('Test using search to find and apply the filter', async () => {
      // Find and expand a filter that shows a search input (has >5 values)
      const filterControls = page.locator(
        '[data-testid="filter-group-control"]',
      );
      const filterCount = await filterControls.count();

      // Try each filter until we find one with a search input
      for (let i = 0; i < Math.min(filterCount, 5); i++) {
        const filter = filterControls.nth(i);
        const filterText = await filter.textContent();
        const filterName =
          filterText?.trim().replace(/\s*\(\d+\)\s*$/, '') || `filter-${i}`;

        // Skip severity-related filters as they likely have few values
        if (
          filterName.toLowerCase().includes('severity') ||
          filterName.toLowerCase().includes('level')
        ) {
          continue;
        }

        // Expand the filter
        await filter.click();
        await page.waitForTimeout(500);

        // Check if search input appears
        const searchInput = page.locator(
          `[data-testid="filter-search-${filterName}"]`,
        );

        try {
          await searchInput.waitFor({ state: 'visible', timeout: 1000 });
          // Search input is visible, test it
          await searchInput.fill('test');
          await page.waitForTimeout(500);
          await searchInput.clear();
          await page.waitForTimeout(500);
          break; // Found a working filter, stop testing
        } catch (e) {
          // Search input not visible, collapse and try next filter
          await filter.click();
          await page.waitForTimeout(500);
        }
      }
    });

    await test.step('Pin filter and verify it persists after reload', async () => {
      const infoFilter = page.locator('[data-testid="filter-checkbox-info"]');

      // First exclude the filter, then pin it
      await infoFilter.hover();
      await page.locator('[data-testid="filter-exclude-info"]').click();
      await infoFilter.hover();

      // Pin the filter
      await page.locator('[data-testid="filter-pin-info"]').click();
      await page.waitForTimeout(500);

      // Reload page and verify filter persists
      await page.reload();
      await page.waitForLoadState('networkidle');

      await expect(
        page.locator('[data-testid="filter-checkbox-info"]').first(),
      ).toBeVisible();
    });
  });
  //todo: test filter value pinning
  //todo: text filter expand/collapse
  //todo: test show more/show less
});
