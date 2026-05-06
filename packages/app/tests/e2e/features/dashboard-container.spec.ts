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
    const group = dashboardPage.getGroup(id);
    const chevron = dashboardPage.page.getByTestId(`group-chevron-${id}`);

    await test.step('chevron is present and reports expanded by default', async () => {
      await expect(chevron).toBeVisible();
      await expect(chevron).toHaveAttribute('aria-expanded', 'true');
    });

    await test.step('container body renders an inline border', async () => {
      // DashboardContainer.tsx:243-246 sets inline `border` only when
      // bordered=true. Reading el.style.border avoids resolving the CSS var.
      const inlineBorder = await group.evaluate(
        (el: HTMLElement) => el.style.border,
      );
      expect(inlineBorder.length).toBeGreaterThan(0);
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

  test('toggling bordered via the overflow menu flips the inline border', async () => {
    const id = await addGroupAndGetId();
    const group = dashboardPage.getGroup(id);

    const readBorder = () =>
      group.evaluate((el: HTMLElement) => el.style.border);

    await test.step('starts with an inline border', async () => {
      expect((await readBorder()).length).toBeGreaterThan(0);
    });

    await test.step('Hide Border removes the inline border', async () => {
      await dashboardPage.toggleGroupBordered(id);
      // The toggle is synchronous, but allow the inline style update to
      // flush before reading.
      await expect
        .poll(async () => (await readBorder()).length, { timeout: 5000 })
        .toBe(0);
    });

    await test.step('the menu now offers Show Border and restores it', async () => {
      await dashboardPage.openGroupMenu(id);
      await expect(
        dashboardPage.page.getByTestId(`group-toggle-bordered-${id}`),
      ).toHaveText('Show Border');
      await dashboardPage.page
        .getByTestId(`group-toggle-bordered-${id}`)
        .click();
      await expect
        .poll(async () => (await readBorder()).length, { timeout: 5000 })
        .toBeGreaterThan(0);
    });
  });

  test('adding a tab reveals the tab bar and switching tabs updates URL state', async () => {
    const id = await addGroupAndGetId();
    const group = dashboardPage.getGroup(id);
    const tabsInGroup = group.getByRole('tab');

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
      // selected, so the URL param already records the second tab's id.
      // We use the URL as the source of truth for ids rather than parsing
      // them out of Mantine's internal DOM.
      const secondTabId = dashboardPage.getActiveTabsParam()[id];
      expect(secondTabId).toBeTruthy();

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
    const chevron = dashboardPage.page.getByTestId(`group-chevron-${id}`);

    await test.step('collapsing a default-expanded group writes ?collapsed=', async () => {
      await chevron.click();
      await expect.poll(() => dashboardPage.getCollapsedParam()).toContain(id);
      expect(dashboardPage.getExpandedParam()).not.toContain(id);
    });

    await test.step('the collapsed state persists across reload', async () => {
      await dashboardPage.page.reload();
      await expect(
        dashboardPage.page.getByTestId('dashboard-page'),
      ).toBeVisible();
      const reloadedChevron = dashboardPage.page.getByTestId(
        `group-chevron-${id}`,
      );
      await expect(reloadedChevron).toHaveAttribute('aria-expanded', 'false');
      expect(dashboardPage.getCollapsedParam()).toContain(id);
    });

    await test.step('expanding again moves the id to ?expanded= and survives reload', async () => {
      await dashboardPage.page.getByTestId(`group-chevron-${id}`).click();
      await expect.poll(() => dashboardPage.getExpandedParam()).toContain(id);
      expect(dashboardPage.getCollapsedParam()).not.toContain(id);

      await dashboardPage.page.reload();
      await expect(
        dashboardPage.page.getByTestId('dashboard-page'),
      ).toBeVisible();
      await expect(
        dashboardPage.page.getByTestId(`group-chevron-${id}`),
      ).toHaveAttribute('aria-expanded', 'true');
    });
  });

  test('?activeTabs URL param survives reload and restores the active tab', async () => {
    const id = await addGroupAndGetId();
    await dashboardPage.addTabToGroup(id);

    const tabs = dashboardPage.getGroup(id).getByRole('tab');
    await expect(tabs).toHaveCount(2);

    // The URL stores the active tab id; capture it as the source of truth.
    const secondTabId = dashboardPage.getActiveTabsParam()[id];
    expect(secondTabId).toBeTruthy();

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
      await expect(
        dashboardPage.page.getByTestId('dashboard-page'),
      ).toBeVisible();
      const reloadedTabs = dashboardPage.getGroup(id).getByRole('tab');
      await expect(reloadedTabs.last()).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(dashboardPage.getActiveTabsParam()[id]).toBe(secondTabId);
    });
  });

  test('save-and-reload round-trip preserves containers, bordered state, and tabs', async () => {
    // Two groups: group A starts default; group B gets a second tab. We
    // toggle bordered=false on group A so the round-trip exercises the
    // schema field that PR #2015 added.
    const idA = await addGroupAndGetId();
    const idB = await addGroupAndGetId();

    await test.step('configure group A (no border) and group B (two tabs)', async () => {
      await dashboardPage.toggleGroupBordered(idA);
      await dashboardPage.addTabToGroup(idB);

      const groupATabs = dashboardPage.getGroup(idB).getByRole('tab');
      await expect(groupATabs).toHaveCount(2);
    });

    const dashboardUrl = dashboardPage.page.url();

    await test.step('navigate away then back', async () => {
      await dashboardPage.page.goto('/search');
      await expect(dashboardPage.page).toHaveURL(/.*\/search/);

      // Strip query params so the reload doesn't carry stale per-viewer state.
      const dashboardId = dashboardPage.page
        .url()
        .match(/\/dashboards\/([^/?#]+)/)?.[1];
      const baseId =
        dashboardId ?? new URL(dashboardUrl).pathname.split('/').pop();
      await dashboardPage.page.goto(`/dashboards/${baseId}`);
      await expect(
        dashboardPage.page.getByTestId('dashboard-page'),
      ).toBeVisible();
    });

    await test.step('both containers are present in original order', async () => {
      const order = await dashboardPage.getGroupOrder();
      expect(order).toEqual([idA, idB]);
    });

    await test.step('group A retains its borderless state', async () => {
      const inlineBorder = await dashboardPage
        .getGroup(idA)
        .evaluate((el: HTMLElement) => el.style.border);
      expect(inlineBorder).toBe('');
    });

    await test.step('group B still has two tabs', async () => {
      const tabs = dashboardPage.getGroup(idB).getByRole('tab');
      await expect(tabs).toHaveCount(2);
    });
  });

  test('drag-to-reorder rearranges groups and the new order persists', async () => {
    test.setTimeout(60000);

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
      const dashboardUrl = dashboardPage.page.url();
      const dashboardId = dashboardUrl.match(/\/dashboards\/([^/?#]+)/)?.[1];
      await dashboardPage.page.goto('/search');
      await expect(dashboardPage.page).toHaveURL(/.*\/search/);
      await dashboardPage.page.goto(`/dashboards/${dashboardId}`);
      await expect(
        dashboardPage.page.getByTestId('dashboard-page'),
      ).toBeVisible();

      await expect
        .poll(() => dashboardPage.getGroupOrder())
        .toEqual([idB, idC, idA]);
    });
  });
});
