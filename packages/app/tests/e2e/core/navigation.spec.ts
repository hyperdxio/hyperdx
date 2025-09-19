import { expect, test } from '../utils/base-test';

test.describe('Navigation', { tag: ['@core'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
    await page.waitForLoadState();
  });

  test(
    'should navigate between main pages',
    { tag: '@smoke' },
    async ({ page }) => {
      await test.step('Wait for page to load', async () => {
        await page.waitForLoadState('networkidle');
        // Wait for the first navigation link to be visible instead of using a fixed timeout
        await expect(
          page.locator('[data-testid="nav-link-search"]'),
        ).toBeVisible();
      });

      await test.step('Verify all main navigation links are present and have correct hrefs', async () => {
        const navLinks = [
          { testId: 'nav-link-search', href: '/search' },
          { testId: 'nav-link-chart', href: '/chart' },
          { testId: 'nav-link-sessions', href: '/sessions' },
          { testId: 'nav-link-dashboards', href: '/dashboards' },
        ];

        for (const { testId, href } of navLinks) {
          const locator = page.locator(`[data-testid="${testId}"]`);
          await expect(locator).toBeVisible();
          await expect(locator).toHaveAttribute('href', href);
        }
      });
    },
  );
  test('should open user menu', async ({ page }) => {
    await test.step('Navigate to and click user menu trigger', async () => {
      // Wait for page to be fully loaded first
      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="nav-link-search"]'),
      ).toBeVisible();

      const userMenuTrigger = page.locator('[data-testid="user-menu-trigger"]');
      await userMenuTrigger.scrollIntoViewIfNeeded();
      await expect(userMenuTrigger).toBeVisible();

      // Wait for the element to be fully interactive and click with extended timeout
      await userMenuTrigger.waitFor({ state: 'attached' });
      await userMenuTrigger.click({ timeout: 10000 });

      // Wait for the menu to appear
      await expect(
        page.locator('[data-testid="user-preferences-menu-item"]'),
      ).toBeVisible();
    });

    await test.step('Verify user menu items are accessible', async () => {
      const userPreferencesItem = page.locator(
        '[data-testid="user-preferences-menu-item"]',
      );
      await expect(userPreferencesItem).toBeVisible();
    });

    //todo: Add tests that verify user pref behavior
  });

  test('should open help menu', async ({ page }) => {
    await test.step('Navigate to and click help menu trigger', async () => {
      // Wait for page to be fully loaded first
      await page.waitForLoadState('networkidle');
      await expect(
        page.locator('[data-testid="nav-link-search"]'),
      ).toBeVisible();

      const helpMenuTrigger = page.locator('[data-testid="help-menu-trigger"]');
      await helpMenuTrigger.scrollIntoViewIfNeeded();
      await expect(helpMenuTrigger).toBeVisible();

      // Wait for the element to be fully interactive and click with extended timeout
      await helpMenuTrigger.waitFor({ state: 'attached' });
      await helpMenuTrigger.click({ timeout: 10000 });

      // Wait for the menu items to appear
      await expect(
        page.locator('[data-testid="documentation-menu-item"]'),
      ).toBeVisible();
    });

    await test.step('Verify help menu items are accessible', async () => {
      const documentationItem = page.locator(
        '[data-testid="documentation-menu-item"]',
      );
      const discordItem = page.locator('[data-testid="discord-menu-item"]');
      const setupItem = page.locator(
        '[data-testid="setup-instructions-menu-item"]',
      );

      await expect(documentationItem).toBeVisible();
      await expect(discordItem).toBeVisible();
      await expect(setupItem).toBeVisible();
    });
  });
});

// Full-server tests that require authentication and backend services
test.skip('Navigation - Full Server Features', { tag: ['@core'] }, () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/search');
  });

  test('should show full server navigation links', async ({ page }) => {
    await test.step('Verify team settings link is visible', async () => {
      const teamSettingsLink = page.locator(
        '[data-testid="nav-link-team-settings"]',
      );
      await expect(teamSettingsLink).toBeVisible();
      await expect(teamSettingsLink).toHaveAttribute('href', '/team-settings');
    });

    await test.step('Verify alerts link functionality', async () => {
      const alertsLink = page.locator('[data-testid="nav-link-alerts"]');
      await expect(alertsLink).toBeVisible();
      await expect(alertsLink).toHaveAttribute('href', '/alerts');

      // In full-server mode, we can actually navigate to alerts
      await alertsLink.click();
      await page.waitForURL('**/alerts**');
      await expect(page).toHaveURL(/.*\/alerts/);
    });
  });
});
