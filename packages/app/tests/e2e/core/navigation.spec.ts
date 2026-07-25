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
    // Serve a deterministic "What's new" payload so the inline section renders
    // fixed rows regardless of the current CHANGELOG. Registered before the menu
    // opens, since the fetch fires on open.
    await page.route('**/whats-new.json', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          releases: [
            {
              version: '9.9.9',
              features: [
                { scope: 'charts', text: 'First shiny feature' },
                { scope: 'general', text: 'Second shiny feature' },
              ],
              highlight: {
                title: 'The big headline feature',
                blurb: 'A **great** thing landed this release.',
              },
            },
            {
              version: '9.9.8',
              features: [{ scope: 'general', text: 'An older feature' }],
            },
          ],
        }),
      }),
    );

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
      const shortcutsItem = page.locator(
        '[data-testid="keyboard-shortcuts-menu-item"]',
      );
      const discordItem = page.locator('[data-testid="discord-menu-item"]');
      const viewAllReleasesItem = page.locator(
        '[data-testid="view-all-releases-menu-item"]',
      );

      await expect(documentationItem).toBeVisible();
      await expect(setupItem).toBeVisible();
      await expect(shortcutsItem).toBeVisible();
      await expect(discordItem).toBeVisible();
      await expect(viewAllReleasesItem).toBeVisible();
    });

    await test.step("Verify What's new section renders inline", async () => {
      // The latest release's feature headlines render as inline timeline rows,
      // each with a "New" badge — no modal.
      const items = page.getByTestId('whats-new-item');
      await expect(items.first()).toBeVisible({ timeout: 10_000 });
      await expect(items).toHaveCount(2);
      await expect(items.getByText('First shiny feature')).toBeVisible();
      await expect(items.getByText('New').first()).toBeVisible();
    });

    await test.step('Open the What\'s new drawer from "View all releases"', async () => {
      await page.getByTestId('view-all-releases-menu-item').click();

      const drawer = page.getByTestId('whats-new-drawer');
      await expect(drawer).toBeVisible({ timeout: 10_000 });
      // Newest release, its hand-authored highlight, and the older release all
      // render; the full changelog stays one click away.
      await expect(drawer.getByText('v9.9.9')).toBeVisible();
      await expect(drawer.getByText('The big headline feature')).toBeVisible();
      // The highlight blurb is markdown, so its **bold** must render as real
      // <strong>, not literal asterisks.
      await expect(
        drawer.locator('strong', { hasText: 'great' }),
      ).toBeVisible();
      // Features are tagged with their feat() scope.
      await expect(drawer.getByText('charts')).toBeVisible();
      await expect(drawer.getByTestId('whats-new-release')).toHaveCount(2);
      await expect(drawer.getByTestId('drawer-github-link')).toHaveAttribute(
        'href',
        /github\.com\/hyperdxio\/hyperdx.*CHANGELOG\.md/,
      );

      // Opening the drawer closes the menu.
      await expect(
        page.getByTestId('keyboard-shortcuts-menu-item'),
      ).toBeHidden();

      await page.keyboard.press('Escape');
      await expect(drawer).toBeHidden();
    });

    await test.step('Open keyboard shortcuts from help menu', async () => {
      // The drawer closed the menu, so reopen it first.
      await page.getByTestId('help-menu-trigger').click({ timeout: 10000 });

      const shortcutsItem = page.getByTestId('keyboard-shortcuts-menu-item');
      await shortcutsItem.scrollIntoViewIfNeeded();
      await shortcutsItem.click();

      await expect(
        page.getByRole('dialog', { name: 'Keyboard Shortcuts' }),
      ).toBeVisible({ timeout: 10_000 });
    });
  });

  test("should degrade gracefully when What's new fails to load", async ({
    page,
  }) => {
    // Force the data asset to 404 so the inline rows can't populate.
    await page.route('**/whats-new.json', route =>
      route.fulfill({ status: 404, body: 'not found' }),
    );

    await expect(page.locator('[data-testid="nav-link-search"]')).toBeVisible();

    const helpMenuTrigger = page.getByTestId('help-menu-trigger');
    await helpMenuTrigger.click({ timeout: 10000 });

    // The feature rows collapse, but the section header and the link out to the
    // full changelog (with its package icon) still render so users aren't
    // stranded.
    const viewAll = page.getByTestId('view-all-releases-menu-item');
    await expect(viewAll).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('whats-new-item')).toHaveCount(0);

    // The drawer must show its error branch rather than spinning forever — the
    // inline count above passes vacuously, so this is what actually pins the
    // failure path.
    await viewAll.click();
    const drawer = page.getByTestId('whats-new-drawer');
    await expect(drawer).toBeVisible({ timeout: 10_000 });
    await expect(
      drawer.getByText('Unable to load recent releases.'),
    ).toBeVisible();
    await expect(drawer.getByRole('link')).toHaveAttribute(
      'href',
      /github\.com\/hyperdxio\/hyperdx.*CHANGELOG\.md/,
    );
  });

  test("What's new falls back to the newest release that has features", async ({
    page,
  }) => {
    // Fix-only patch releases parse to zero features (10 of 71 real releases so
    // far). The section must not go blank on those — it shows the newest release
    // that does have features, and labels itself with *that* version.
    await page.route('**/whats-new.json', route =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          releases: [
            { version: '9.9.9', features: [] },
            {
              version: '9.9.8',
              features: [{ scope: 'charts', text: 'A feature worth showing' }],
            },
          ],
        }),
      }),
    );

    await expect(page.locator('[data-testid="nav-link-search"]')).toBeVisible();
    await page.getByTestId('help-menu-trigger').click({ timeout: 10000 });

    const items = page.getByTestId('whats-new-item');
    await expect(items).toHaveCount(1);
    await expect(items.getByText('A feature worth showing')).toBeVisible();
    await expect(page.getByText("What's new in v9.9.8")).toBeVisible();
  });
});
