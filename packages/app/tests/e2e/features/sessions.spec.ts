import { SessionsPage } from '../page-objects/SessionsPage';
import { expect, test } from '../utils/base-test';

test.describe('Client Sessions Functionality', { tag: ['@sessions'] }, () => {
  let sessionsPage: SessionsPage;

  test.beforeEach(async ({ page }) => {
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
        // row detail panel that had the Session Replay tab open. Selecting a session event
        // must clear this param (clearInnerNavigation) so the in-place event detail opens to
        // its default tab instead of re-rendering the Session Replay tab.
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

      await test.step('Event detail opens in place inside the single session drawer — not as a second drawer', async () => {
        // Single-drawer navigation: the event detail renders in place inside the
        // existing session-side-panel (via DBRowSidePanelInner). No second
        // row-side-panel Drawer is opened.
        await expect(sessionsPage.sessionSidePanel).toBeVisible();

        // Exactly one session drawer exists, and no separate row-side-panel
        // drawer was stacked on top of it.
        await expect(page.getByTestId('session-side-panel')).toHaveCount(1);
        await expect(page.getByTestId('row-side-panel')).toHaveCount(0);

        // The session drawer now shows the event detail TabBar (Overview, Trace,
        // etc.). This guards against the regression where selecting an event
        // re-opened session replay instead of showing event details (which has
        // no TabBar, just the replay player).
        await expect(
          sessionsPage.sessionSidePanel.getByTestId('side-panel-tabs'),
        ).toBeVisible();

        // The event detail must NOT land on the Session Replay tab. Selecting an
        // event clears the sidePanelTab=replay param injected above
        // (clearInnerNavigation), so the inner panel opens to its default tab
        // (Trace/Overview) and the replay tab content is not rendered.
        await expect(
          sessionsPage.sessionSidePanel.getByTestId('side-panel-tab-replay'),
        ).toHaveCount(0);
      });

      await test.step('Pressing Escape returns to the session event list within the same drawer', async () => {
        // SessionSidePanel owns the Esc hotkey: when an event is selected it
        // pops back to the session root (handleNavigateBack) instead of closing
        // the whole drawer.
        await page.keyboard.press('Escape');

        // The event detail TabBar collapses back to the session event list.
        await expect(
          sessionsPage.sessionSidePanel.getByTestId('side-panel-tabs'),
        ).toBeHidden();
        await expect(sessionsPage.getSessionEventRows().first()).toBeVisible();

        // The session drawer itself stays open.
        await expect(sessionsPage.sessionSidePanel).toBeVisible();
      });
    },
  );
});
