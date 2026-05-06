/**
 * E2E coverage for the unified DashboardContainer (collapsible / bordered
 * / tabbed / drag-to-reorder). Follow-up to PR #2015.
 *
 * The container UX: a "group" wraps a set of tiles. Each container can be
 * collapsible, bordered, and split into tabs. Per-viewer state (collapsed
 * vs expanded, active tab) lives in URL query params (`?collapsed=`,
 * `?expanded=`, `?activeTabs=`) so links share the visible state without
 * mutating the saved dashboard.
 *
 * Source references:
 *  - packages/app/src/components/DashboardContainer.tsx
 *  - packages/app/src/components/GroupTabBar.tsx
 *  - packages/app/src/components/DashboardDndContext.tsx
 *  - packages/app/src/DBDashboardPage.tsx (handleToggleCollapse, query state)
 *  - packages/app/src/hooks/useDashboardContainers.tsx (handleReorderContainers)
 */
import { DashboardPage } from '../page-objects/DashboardPage';
import { expect, test } from '../utils/base-test';

test.describe('Dashboard container', { tag: ['@dashboard'] }, () => {
  // Tests that PATCH the saved dashboard (round-trip / drag-persists) get
  // an additional `@full-stack` tag so the backend-bearing CI lane picks
  // them up. UI-only tests stay on `@dashboard` only.
  let dashboardPage: DashboardPage;

  test.beforeEach(async ({ page }) => {
    dashboardPage = new DashboardPage(page);
    await dashboardPage.goto();
    await dashboardPage.createNewDashboard();
  });

  /**
   * Helper: add a group, return its container id.
   *
   * `useDashboardContainers.handleAddContainer` sets `collapsed: false` and
   * leaves `collapsible` / `bordered` undefined, so both default to `true`
   * via `container.collapsible !== false` / `container.bordered !== false`
   * in DashboardContainer.tsx:83-84.
   */
  async function addGroupAndGetId(): Promise<string> {
    const before = await dashboardPage.getGroupOrder();
    await dashboardPage.addGroup();
    await expect(dashboardPage.getGroups()).toHaveCount(before.length + 1);
    const after = await dashboardPage.getGroupOrder();
    const newId = after.find(id => !before.includes(id));
    if (!newId) throw new Error('Newly added group id not found');
    return newId;
  }

  test('group renders with default collapsible chevron and bordered style', async () => {
    const id = await addGroupAndGetId();
    const chevron = dashboardPage.getGroupChevron(id);

    await test.step('chevron is present and reports expanded by default', async () => {
      await expect(chevron).toBeVisible();
      await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    });

    await test.step('container reports bordered via data-bordered', async () => {
      // The component sets `data-bordered="true|false"` on the container
      // shell. Reading the attribute keeps the spec decoupled from the
      // particular style strategy (inline `border`, CSS var, etc.).
      expect(await dashboardPage.getGroupBorderedAttr(id)).toBe('true');
    });

    await test.step('clicking the chevron collapses the group', async () => {
      await chevron.click();
      await expect(chevron).toHaveAttribute('aria-expanded', 'false');
    });

    await test.step('clicking the chevron again re-expands it', async () => {
      await chevron.click();
      await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    });
  });

  test('toggling bordered via the overflow menu flips data-bordered', async () => {
    const id = await addGroupAndGetId();

    await test.step('starts as bordered', async () => {
      expect(await dashboardPage.getGroupBorderedAttr(id)).toBe('true');
    });

    await test.step('Hide Border flips data-bordered to false', async () => {
      await dashboardPage.toggleGroupBordered(id);
      await expect
        .poll(() => dashboardPage.getGroupBorderedAttr(id), { timeout: 5000 })
        .toBe('false');
    });

    await test.step('the menu now offers Show Border and restores it', async () => {
      await dashboardPage.openGroupMenu(id);
      const borderedToggle = dashboardPage.getGroupBorderedToggle(id);
      await expect(borderedToggle).toHaveText('Show Border');
      await borderedToggle.click();
      await expect
        .poll(() => dashboardPage.getGroupBorderedAttr(id), { timeout: 5000 })
        .toBe('true');
    });
  });

  test('adding a tab reveals the tab bar and switching tabs updates URL state', async () => {
    const id = await addGroupAndGetId();
    const tabsInGroup = dashboardPage.getGroupTabs(id);

    await test.step('a one-tab group does not render the tab bar', async () => {
      // DashboardContainer.tsx:82 sets `hasTabs = tabs.length >= 2`. The new
      // group has 1 tab, so no Tabs.List renders.
      await expect(tabsInGroup).toHaveCount(0);
    });

    await test.step('Add Tab brings the tab bar with two tabs', async () => {
      await dashboardPage.addTabToGroup(id);
      await expect(tabsInGroup).toHaveCount(2);
    });

    await test.step('switching tabs updates ?activeTabs and aria-selected', async () => {
      // After Add Tab, handleAddTab + handleTabChange leave the new tab
      // selected, so the URL param eventually records the second tab's id.
      // nuqs flushes URL state asynchronously, so poll rather than read
      // once. We use the URL as the source of truth for ids rather than
      // parsing them out of Mantine's internal DOM.
      await expect
        .poll(() => dashboardPage.getActiveTabsParam()[id])
        .toBeTruthy();
      const secondTabId = dashboardPage.getActiveTabsParam()[id]!;

      await tabsInGroup.first().click();
      await expect
        .poll(() => dashboardPage.getActiveTabsParam()[id])
        .not.toBe(secondTabId);
      await expect(tabsInGroup.first()).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(tabsInGroup.last()).toHaveAttribute(
        'aria-selected',
        'false',
      );

      await tabsInGroup.last().click();
      await expect
        .poll(() => dashboardPage.getActiveTabsParam()[id])
        .toBe(secondTabId);
      await expect(tabsInGroup.last()).toHaveAttribute('aria-selected', 'true');
    });
  });

  test('?collapsed URL param survives reload and restores the collapsed state', async () => {
    const id = await addGroupAndGetId();
    const chevron = dashboardPage.getGroupChevron(id);

    // The two `useQueryState` setters (?collapsed and ?expanded) flush
    // independently after a chevron click. Reading both as a tuple inside
    // `expect.poll` avoids a one-shot read of the slow side after the
    // fast side already resolved.
    const readCollapseTuple = () => ({
      collapsed: dashboardPage.getCollapsedParam(),
      expanded: dashboardPage.getExpandedParam(),
    });

    await test.step('collapsing a default-expanded group writes ?collapsed=', async () => {
      await chevron.click();
      await expect.poll(readCollapseTuple).toMatchObject({
        collapsed: expect.arrayContaining([id]),
        expanded: expect.not.arrayContaining([id]),
      });
    });

    await test.step('the collapsed state persists across reload', async () => {
      await dashboardPage.page.reload();
      await dashboardPage.waitForLoaded();
      const reloadedChevron = dashboardPage.getGroupChevron(id);
      await expect(reloadedChevron).toHaveAttribute('aria-expanded', 'false');
      expect(dashboardPage.getCollapsedParam()).toContain(id);
    });

    await test.step('expanding again moves the id to ?expanded= and survives reload', async () => {
      await dashboardPage.getGroupChevron(id).click();
      await expect.poll(readCollapseTuple).toMatchObject({
        collapsed: expect.not.arrayContaining([id]),
        expanded: expect.arrayContaining([id]),
      });

      await dashboardPage.page.reload();
      await dashboardPage.waitForLoaded();
      await expect(dashboardPage.getGroupChevron(id)).toHaveAttribute(
        'aria-expanded',
        'true',
      );
    });
  });

  test('?activeTabs URL param survives reload and restores the active tab', async () => {
    const id = await addGroupAndGetId();
    await dashboardPage.addTabToGroup(id);

    const tabs = dashboardPage.getGroupTabs(id);
    await expect(tabs).toHaveCount(2);

    // The URL stores the active tab id; capture it as the source of truth.
    // nuqs flushes URL state asynchronously, so poll rather than read once.
    await expect
      .poll(() => dashboardPage.getActiveTabsParam()[id])
      .toBeTruthy();
    const secondTabId = dashboardPage.getActiveTabsParam()[id]!;

    await test.step('switch to the first tab so the URL reflects it', async () => {
      await tabs.first().click();
      await expect
        .poll(() => dashboardPage.getActiveTabsParam()[id])
        .not.toBe(secondTabId);
    });

    await test.step('switch back to the second tab and reload', async () => {
      await tabs.last().click();
      await expect
        .poll(() => dashboardPage.getActiveTabsParam()[id])
        .toBe(secondTabId);

      await dashboardPage.page.reload();
      await dashboardPage.waitForLoaded();
      const reloadedTabs = dashboardPage.getGroupTabs(id);
      await expect(reloadedTabs.last()).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect
        .poll(() => dashboardPage.getActiveTabsParam()[id])
        .toBe(secondTabId);
    });
  });

  test(
    'save-and-reload round-trip preserves containers and tabs',
    { tag: '@full-stack' },
    async () => {
      // Two groups: group A is left default-bordered, group B gets a second
      // tab. Bordered toggle is exercised in its own test and is
      // intentionally kept out of this round-trip. setDashboard for a
      // remote dashboard fires PATCH /api/dashboards/{id} without an
      // optimistic update, so back-to-back mutations that derive from the
      // same in-memory snapshot can clobber each other; this test sequences
      // its mutating actions deliberately and waits for the backend to
      // confirm before navigating away.
      const idA = await addGroupAndGetId();
      const idB = await addGroupAndGetId();

      // Start listening for the addTabToGroup PATCH before issuing it,
      // because a fast handler can return before the spec reaches a
      // post-hoc `waitForResponse`.
      const tabPatch = dashboardPage.waitForDashboardPatch();

      await test.step('group B gets a second tab', async () => {
        await dashboardPage.addTabToGroup(idB);
        const groupBTabs = dashboardPage.getGroupTabs(idB);
        await expect(groupBTabs).toHaveCount(2);
      });

      // Capture the dashboard id from the URL while we're still on the page.
      const dashboardId = dashboardPage.getCurrentDashboardId();

      await test.step('wait for the addTab PATCH to land before leaving', async () => {
        // setDashboard mutations are fire-and-forget; if we navigate
        // before the PATCH lands, the change is dropped.
        await tabPatch;
      });

      await test.step('navigate away then back', async () => {
        await dashboardPage.page.goto('/search');
        await expect(dashboardPage.page).toHaveURL(/.*\/search/);

        await dashboardPage.page.goto(`/dashboards/${dashboardId}`);
        await dashboardPage.waitForLoaded();
      });

      await test.step('both containers are present in original order', async () => {
        // Poll because the reloaded dashboard hydrates via a remote fetch.
        await expect
          .poll(() => dashboardPage.getGroupOrder())
          .toEqual([idA, idB]);
      });

      await test.step('group B still has two tabs', async () => {
        const tabs = dashboardPage.getGroupTabs(idB);
        await expect(tabs).toHaveCount(2);
      });
    },
  );

  test(
    'drag-to-reorder rearranges groups and the new order persists',
    { tag: '@full-stack' },
    async () => {
      const idA = await addGroupAndGetId();
      const idB = await addGroupAndGetId();
      const idC = await addGroupAndGetId();

      await test.step('initial order is [A, B, C]', async () => {
        expect(await dashboardPage.getGroupOrder()).toEqual([idA, idB, idC]);
      });

      await test.step('drag onto self is a no-op', async () => {
        // DashboardDndContext.tsx:67-70 guards
        // `activeData.containerId !== overData.containerId`.
        await dashboardPage.dragGroupTo(idA, idA);
        expect(await dashboardPage.getGroupOrder()).toEqual([idA, idB, idC]);
      });

      // Start listening for the reorder PATCH before issuing the drag.
      const reorderPatch = dashboardPage.waitForDashboardPatch();

      await test.step('dragging A onto C produces [B, C, A]', async () => {
        // arrayMove(containers, indexOf(A)=0, indexOf(C)=2) yields the @dnd-kit
        // documented "shift" semantics: [B, C, A]. See
        // useDashboardContainers.handleReorderContainers and
        // DashboardDndContext.handleDragEnd.
        await dashboardPage.dragGroupTo(idA, idC);
        await expect
          .poll(() => dashboardPage.getGroupOrder())
          .toEqual([idB, idC, idA]);
      });

      await test.step('the new order persists across navigation', async () => {
        const dashboardId = dashboardPage.getCurrentDashboardId();
        // Wait for the reorder PATCH before leaving the page; otherwise the
        // mutation is dropped on the goto.
        await reorderPatch;

        await dashboardPage.page.goto('/search');
        await expect(dashboardPage.page).toHaveURL(/.*\/search/);
        await dashboardPage.page.goto(`/dashboards/${dashboardId}`);
        await dashboardPage.waitForLoaded();

        await expect
          .poll(() => dashboardPage.getGroupOrder())
          .toEqual([idB, idC, idA]);
      });
    },
  );
});
