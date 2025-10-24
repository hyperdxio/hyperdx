import { expect, test } from '../utils/base-test';

test.describe('Context-Aware Navigation', { tag: ['@navigation'] }, () => {
  test('should carry context from search to chart explorer', async ({
    page,
  }) => {
    // Step 1: Go to search page and set up context
    await test.step('Set up search context', async () => {
      await page.goto('/search?from=1234567890&to=1234577890&tq=Past%201h');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Wait for page to be ready
      await expect(
        page.locator('[data-testid="nav-link-search"]'),
      ).toBeVisible();
    });

    // Step 2: Navigate to chart explorer via nav link
    await test.step('Navigate to chart explorer', async () => {
      const chartLink = page.locator('[data-testid="nav-link-chart"]');
      await expect(chartLink).toBeVisible();
      await chartLink.click();
      await page.waitForLoadState('networkidle');
    });

    // Step 3: Verify context was carried over
    await test.step('Verify time range context was preserved', async () => {
      const url = new URL(page.url());
      
      // Check that time range parameters are present
      expect(url.searchParams.get('from')).toBe('1234567890');
      expect(url.searchParams.get('to')).toBe('1234577890');
      expect(url.searchParams.get('tq')).toBe('Past 1h');
    });
  });

  test('should carry context from chart to search page', async ({ page }) => {
    // Step 1: Go to chart page with context
    await test.step('Set up chart context', async () => {
      await page.goto('/chart?from=1234567890&to=1234577890&tq=Past%201h');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      // Wait for chart form to be ready
      await expect(
        page.locator('[data-testid="chart-explorer-form"]'),
      ).toBeVisible();
    });

    // Step 2: Navigate to search via nav link
    await test.step('Navigate to search page', async () => {
      const searchLink = page.locator('[data-testid="nav-link-search"]');
      await expect(searchLink).toBeVisible();
      await searchLink.click();
      await page.waitForLoadState('networkidle');
    });

    // Step 3: Verify context was carried over
    await test.step('Verify time range context was preserved', async () => {
      const url = new URL(page.url());
      
      // Check that time range parameters are present
      expect(url.searchParams.get('from')).toBe('1234567890');
      expect(url.searchParams.get('to')).toBe('1234577890');
      expect(url.searchParams.get('tq')).toBe('Past 1h');
    });
  });

  test('should carry where clause from search to chart', async ({ page }) => {
    // Step 1: Go to search page with where clause
    await test.step('Set up search with where clause', async () => {
      await page.goto(
        '/search?where=level%3Aerror&whereLanguage=lucene&from=1234567890&to=1234577890',
      );
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);

      await expect(
        page.locator('[data-testid="nav-link-search"]'),
      ).toBeVisible();
    });

    // Step 2: Navigate to chart explorer
    await test.step('Navigate to chart explorer', async () => {
      const chartLink = page.locator('[data-testid="nav-link-chart"]');
      await expect(chartLink).toBeVisible();
      await chartLink.click();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    });

    // Step 3: Verify where clause was carried over
    await test.step('Verify where clause was preserved in URL', async () => {
      const url = new URL(page.url());
      
      expect(url.searchParams.get('where')).toBe('level:error');
      expect(url.searchParams.get('whereLanguage')).toBe('lucene');
    });
  });

  test('should not carry context to non-search/chart pages', async ({
    page,
  }) => {
    // Step 1: Go to search with context
    await test.step('Set up search context', async () => {
      await page.goto('/search?from=1234567890&to=1234577890&where=test');
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
    });

    // Step 2: Navigate to sessions page
    await test.step('Navigate to sessions page', async () => {
      const sessionsLink = page.locator('[data-testid="nav-link-sessions"]');
      await expect(sessionsLink).toBeVisible();
      await sessionsLink.click();
      await page.waitForLoadState('networkidle');
    });

    // Step 3: Verify context was NOT carried over
    await test.step('Verify no search context on sessions page', async () => {
      const url = new URL(page.url());
      
      // Sessions page shouldn't have search where clause
      expect(url.searchParams.get('where')).toBeNull();
    });
  });
});

