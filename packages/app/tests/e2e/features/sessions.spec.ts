import { SessionsPage } from '../page-objects/SessionsPage';
import { expect, test } from '../utils/base-test';

test.describe('Client Sessions Functionality', { tag: ['@sessions'] }, () => {
  let sessionsPage: SessionsPage;

  test.beforeEach(({ page }) => {
    sessionsPage = new SessionsPage(page);
  });

  test('should load sessions page', async () => {
    await test.step('Navigate to sessions page', async () => {
      await sessionsPage.goto();
    });

    await test.step('Verify sessions page components are present', async () => {
      // Use web-first assertions instead of synchronous expect
      await expect(sessionsPage.form).toBeVisible();
      await expect(sessionsPage.dataSource).toBeVisible();
    });
  });

  test('should interact with session cards', async () => {
    await test.step('Navigate to sessions page and wait for load', async () => {
      // First go to search page to trigger onboarding modal handling
      await sessionsPage.page.goto('/search');

      // Then navigate to sessions page
      await sessionsPage.goto();

      // Select the default data source
      await sessionsPage.selectDataSource();
    });

    await test.step('Find and interact with session cards', async () => {
      const firstSession = sessionsPage.getFirstSessionCard();
      await expect(sessionsPage.dataSource).toBeVisible();
      await expect(firstSession).toBeVisible();
      await sessionsPage.openFirstSession();
    });
  });

  test(
    'clicking a session event opens the event detail panel with tabs, not another session replay',
    { tag: ['@full-stack'] },
    async ({ page }) => {
      await test.step('Navigate and open a session (with sidePanelTab=replay pre-set in URL to simulate search-page flow)', async () => {
        // Pre-set sidePanelTab=replay in the URL to simulate navigating from a search page
        // row detail panel that had the Session Replay tab open. Without isNestedPanel=true,
        // the inner DBRowSidePanel would inherit this URL param and open to the Replay tab again.
        await page.goto('/search');
        await sessionsPage.goto();
        await sessionsPage.selectDataSource();
        await expect(sessionsPage.getFirstSessionCard()).toBeVisible();
        // Inject sidePanelTab=replay into the URL before opening the session
        const currentUrl = page.url();
        await page.goto(
          currentUrl.includes('?')
            ? `${currentUrl}&sidePanelTab=replay`
            : `${currentUrl}?sidePanelTab=replay`,
        );
        await expect(sessionsPage.getFirstSessionCard()).toBeVisible();
        await sessionsPage.openFirstSession();
      });

      await test.step('Wait for session replay drawer and event rows to load', async () => {
        await expect(sessionsPage.sessionSidePanel).toBeVisible();
        // Wait for the session event list to populate (routeChange/console.error events are seeded)
        await expect(sessionsPage.getSessionEventRows().first()).toBeVisible({
          timeout: 15000,
        });
      });

      await test.step('Click a session event row', async () => {
        await sessionsPage.clickFirstSessionEvent();
      });

      await test.step('Event detail panel opens alongside the session replay — not replacing it', async () => {
        // The row-side-panel must be visible (event detail drawer opened on top of session replay)
        await expect(sessionsPage.rowSidePanel).toBeVisible();

        // The original session replay panel must still be open (not replaced/closed)
        await expect(sessionsPage.sessionSidePanel).toBeVisible();

        // Only one session-side-panel must exist (not a second replay opened inside the detail panel)
        await expect(page.getByTestId('session-side-panel')).toHaveCount(1);

        // The row-side-panel must show the event detail TabBar (Overview, Trace, etc.)
        // This guards against the regression where the inner panel re-opened session replay
        // instead of showing event details (which has no TabBar, just the replay player)
        await expect(
          sessionsPage.rowSidePanel.getByTestId('side-panel-tabs'),
        ).toBeVisible();

        // The inner panel must NOT be showing the Session Replay tab content.
        // Without isNestedPanel=true (broken), the inner DBRowSidePanel reads sidePanelTab=replay
        // from the URL (injected above) and renders the Session Replay tab content (side-panel-tab-replay).
        // With isNestedPanel=true (fixed), the inner panel uses local state and ignores the URL,
        // opening to its default tab (Trace/Overview) instead.
        await expect(
          sessionsPage.rowSidePanel.getByTestId('side-panel-tab-replay'),
        ).toHaveCount(0);
      });

      await test.step('Clicking the overlay closes the event detail panel but keeps the session replay open', async () => {
        // Without the fix, withOverlay={!isNestedPanel} removed the overlay on nested panels,
        // so there was nothing to click to close the panel (it had to be ESC only).
        // With the fix (withOverlay always true), clicking the Mantine overlay dismisses the inner panel.
        await sessionsPage.clickTopmostDrawerOverlay();

        // The event detail panel must close
        await expect(sessionsPage.rowSidePanel).toBeHidden();

        // The session replay drawer must still be open
        await expect(sessionsPage.sessionSidePanel).toBeVisible();
      });
    },
  );
});
