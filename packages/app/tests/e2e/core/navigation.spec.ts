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
        // Wait for the first navigation link to be visible instead of using a fixed timeout
        await expect(
          page.locator('[data-testid="nav-link-search"]'),
        ).toBeVisible();
      });

      const navLinks = [
        {
          testId: 'nav-link-search',
          href: '/search',
          contentTestId: 'search-page',
        },
        {
          testId: 'nav-link-chart',
          href: '/chart',
          contentTestId: 'chart-explorer-page',
        },
        {
          testId: 'nav-link-sessions',
          href: '/sessions',
          contentTestId: 'sessions-page',
        },
        {
          testId: 'nav-link-service-map',
          href: '/service-map',
          contentTestId: 'service-map-page',
        },
        {
          testId: 'nav-link-dashboards-list',
          href: '/dashboards/list',
          contentTestId: 'dashboards-list-page',
        },
      ];

      await test.step('Verify all main navigation links are present and have correct hrefs', async () => {
        for (const { testId, href } of navLinks) {
          const locator = page.locator(`[data-testid="${testId}"]`);
          await expect(locator).toBeVisible();
          await expect(locator).toHaveAttribute('href', href);
        }
      });

      await test.step('Navigate between each page', async () => {
        for (const { testId, contentTestId } of navLinks) {
          const link = page.locator(`[data-testid="${testId}"]`);
          await link.scrollIntoViewIfNeeded();
          // Use goto via the href attribute to avoid interference from
          // Live Tail URL updates on the search page that can swallow clicks.
          const href = await link.getAttribute('href');
          await page.goto(href!);

          const content = page.locator(`[data-testid="${contentTestId}"]`);
          await expect(content).toBeVisible({ timeout: 30_000 });
        }

        // Navigate back to first page at the end to test navigation away from the last page
        const firstLink = page.locator(`[data-testid="${navLinks[0].testId}"]`);
        const firstHref = await firstLink.getAttribute('href');
        await page.goto(firstHref!);
        const firstContent = page.locator(
          `[data-testid="${navLinks[0].contentTestId}"]`,
        );
        await expect(firstContent).toBeVisible({ timeout: 30_000 });
      });
    },
  );

  test('should open user menu', async ({ page }) => {
    await test.step('Navigate to and click user menu trigger', async () => {
      // Wait for page to be fully loaded first
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
      const setupItem = page.locator(
        '[data-testid="setup-instructions-menu-item"]',
      );
      const changelogItem = page.locator('[data-testid="changelog-menu-item"]');
      const shortcutsItem = page.locator(
        '[data-testid="keyboard-shortcuts-menu-item"]',
      );
      const discordItem = page.locator('[data-testid="discord-menu-item"]');

      await expect(documentationItem).toBeVisible();
      await expect(setupItem).toBeVisible();
      await expect(changelogItem).toBeVisible();
      await expect(shortcutsItem).toBeVisible();
      await expect(discordItem).toBeVisible();
    });

    await test.step('Open changelog from help menu with rendered markdown', async () => {
      const changelogItem = page.getByTestId('changelog-menu-item');
      await changelogItem.scrollIntoViewIfNeeded();
      await changelogItem.click();

      const dialog = page.getByRole('dialog', { name: "What's New" });
      await expect(dialog).toBeVisible({ timeout: 10_000 });

      const modal = dialog.getByTestId('changelog-modal');
      const heading = modal.locator('h2').first();
      const errorText = modal.getByText('Unable to load the changelog.');

      // Wait for the async fetch to settle into either outcome, then assert it
      // settled on success. The changelog asset is copied into public/ by
      // next.config, so a broken copy fails here fast and legibly instead of
      // timing out on the heading check.
      await expect(heading.or(errorText)).toBeVisible({ timeout: 10_000 });
      await expect(errorText).toHaveCount(0);

      // The changelog markdown renders as real HTML (version headings become
      // <h2>), so a visible heading proves it was parsed, not shown raw.
      await expect(heading).toBeVisible();

      // Close so the help menu can be reopened for the next step.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
    });

    await test.step('Open keyboard shortcuts from help menu', async () => {
      // The changelog step closed the menu, so reopen it first.
      const helpMenuTrigger = page.getByTestId('help-menu-trigger');
      await helpMenuTrigger.click({ timeout: 10000 });

      const shortcutsItem = page.getByTestId('keyboard-shortcuts-menu-item');
      await shortcutsItem.scrollIntoViewIfNeeded();
      await shortcutsItem.click();

      await expect(
        page.getByRole('dialog', { name: 'Keyboard Shortcuts' }),
      ).toBeVisible({ timeout: 10_000 });
    });
  });

  test('should show a fallback when the changelog fails to load', async ({
    page,
  }) => {
    // Force the changelog asset to 404 so the modal's error branch renders.
    await page.route('**/CHANGELOG.md', route =>
      route.fulfill({ status: 404, body: 'not found' }),
    );

    await expect(page.locator('[data-testid="nav-link-search"]')).toBeVisible();

    const helpMenuTrigger = page.getByTestId('help-menu-trigger');
    await helpMenuTrigger.click({ timeout: 10000 });

    const changelogItem = page.getByTestId('changelog-menu-item');
    await changelogItem.scrollIntoViewIfNeeded();
    await changelogItem.click();

    const dialog = page.getByRole('dialog', { name: "What's New" });
    await expect(dialog).toBeVisible({ timeout: 10_000 });
    await expect(dialog.getByText('Unable to load the changelog.')).toBeVisible(
      { timeout: 10_000 },
    );
  });
});
