import { act, renderHook } from '@testing-library/react';

import { Dashboard } from '@/dashboard';

import useDashboardContainers from '../useDashboardContainers';

function makeDashboard(overrides: Partial<Dashboard> = {}): Dashboard {
  return {
    name: 'Test Dashboard',
    tiles: [],
    containers: [],
    ...overrides,
  } as Dashboard;
}

function renderContainersHook(dashboard: Dashboard) {
  let current = dashboard;
  const setDashboard = jest.fn((d: Dashboard) => {
    current = d;
  });
  const confirm = jest.fn().mockResolvedValue(true);
  const hook = renderHook(() =>
    useDashboardContainers({
      dashboard: current,
      setDashboard,
      confirm,
    }),
  );
  return { hook, setDashboard, confirm, getDashboard: () => current };
}

describe('useDashboardContainers', () => {
  describe('handleDeleteTab', () => {
    const baseDashboard = makeDashboard({
      containers: [
        {
          id: 'c1',
          title: 'Group',
          collapsed: false,
          tabs: [
            { id: 'tab-1', title: 'Tab One' },
            { id: 'tab-2', title: 'Tab Two' },
            { id: 'tab-3', title: 'Tab Three' },
          ],
          activeTabId: 'tab-1',
        },
      ],
      tiles: [
        { id: 't1', containerId: 'c1', tabId: 'tab-1', x: 0, y: 0, w: 6, h: 4 },
        { id: 't2', containerId: 'c1', tabId: 'tab-1', x: 6, y: 0, w: 6, h: 4 },
        {
          id: 't3',
          containerId: 'c1',
          tabId: 'tab-2',
          x: 0,
          y: 0,
          w: 12,
          h: 4,
        },
        { id: 't4', containerId: 'c1', tabId: 'tab-3', x: 0, y: 0, w: 6, h: 4 },
      ] as Dashboard['tiles'],
    });

    it('action "delete" removes tiles belonging to the deleted tab', () => {
      const { hook, getDashboard } = renderContainersHook(baseDashboard);
      act(() => {
        hook.result.current.handleDeleteTab('c1', 'tab-2', 'delete');
      });

      const result = getDashboard();
      // tile t3 (tab-2) should be removed
      expect(result.tiles.map(t => t.id)).toEqual(['t1', 't2', 't4']);
      // tab-2 should be removed from container
      expect(result.containers![0].tabs!.map(t => t.id)).toEqual([
        'tab-1',
        'tab-3',
      ]);
    });

    it('action "move" moves tiles to the first remaining tab', () => {
      const { hook, getDashboard } = renderContainersHook(baseDashboard);
      act(() => {
        hook.result.current.handleDeleteTab('c1', 'tab-2', 'move');
      });

      const result = getDashboard();
      // All tiles should still exist
      expect(result.tiles).toHaveLength(4);
      // t3 (was tab-2) should now be on tab-1
      const t3 = result.tiles.find(t => t.id === 't3');
      expect(t3?.tabId).toBe('tab-1');
      // tab-2 should be removed
      expect(result.containers![0].tabs!.map(t => t.id)).toEqual([
        'tab-1',
        'tab-3',
      ]);
    });

    it('updates activeTabId when deleting the active tab', () => {
      const { hook, getDashboard } = renderContainersHook(baseDashboard);
      act(() => {
        // Delete tab-1 which is the active tab
        hook.result.current.handleDeleteTab('c1', 'tab-1', 'delete');
      });

      const result = getDashboard();
      // activeTabId should switch to the new first tab
      expect(result.containers![0].activeTabId).toBe('tab-2');
    });

    it('syncs container.title to new first tab after deletion', () => {
      const { hook, getDashboard } = renderContainersHook(baseDashboard);
      act(() => {
        // Delete tab-1 (first tab) — container.title should sync to tab-2
        hook.result.current.handleDeleteTab('c1', 'tab-1', 'delete');
      });

      const result = getDashboard();
      expect(result.containers![0].title).toBe('Tab Two');
    });

    it('does not affect tiles in other tabs when deleting', () => {
      const { hook, getDashboard } = renderContainersHook(baseDashboard);
      act(() => {
        hook.result.current.handleDeleteTab('c1', 'tab-1', 'delete');
      });

      const result = getDashboard();
      // t1, t2 (tab-1) deleted; t3 (tab-2), t4 (tab-3) remain
      expect(result.tiles.map(t => t.id).sort()).toEqual(['t3', 't4']);
    });

    it('handles deleting a tab with no tiles (delete)', () => {
      const emptyTabDashboard = makeDashboard({
        containers: [
          {
            id: 'c1',
            title: 'Group',
            collapsed: false,
            tabs: [
              { id: 'tab-1', title: 'Has Tiles' },
              { id: 'tab-2', title: 'Empty' },
            ],
            activeTabId: 'tab-2',
          },
        ],
        tiles: [
          {
            id: 't1',
            containerId: 'c1',
            tabId: 'tab-1',
            x: 0,
            y: 0,
            w: 6,
            h: 4,
          },
        ] as Dashboard['tiles'],
      });

      const { hook, getDashboard } = renderContainersHook(emptyTabDashboard);
      act(() => {
        hook.result.current.handleDeleteTab('c1', 'tab-2', 'delete');
      });

      const result = getDashboard();
      expect(result.tiles).toHaveLength(1);
      expect(result.containers![0].tabs).toHaveLength(1);
      expect(result.containers![0].activeTabId).toBe('tab-1');
    });

    it('handles deleting last of 2 tabs (move)', () => {
      const twoTabDashboard = makeDashboard({
        containers: [
          {
            id: 'c1',
            title: 'Group',
            collapsed: false,
            tabs: [
              { id: 'tab-1', title: 'Keep' },
              { id: 'tab-2', title: 'Remove' },
            ],
            activeTabId: 'tab-2',
          },
        ],
        tiles: [
          {
            id: 't1',
            containerId: 'c1',
            tabId: 'tab-1',
            x: 0,
            y: 0,
            w: 6,
            h: 4,
          },
          {
            id: 't2',
            containerId: 'c1',
            tabId: 'tab-2',
            x: 0,
            y: 0,
            w: 6,
            h: 4,
          },
        ] as Dashboard['tiles'],
      });

      const { hook, getDashboard } = renderContainersHook(twoTabDashboard);
      act(() => {
        hook.result.current.handleDeleteTab('c1', 'tab-2', 'move');
      });

      const result = getDashboard();
      expect(result.tiles).toHaveLength(2);
      // t2 should now be on tab-1
      expect(result.tiles.find(t => t.id === 't2')?.tabId).toBe('tab-1');
      // Only 1 tab remaining
      expect(result.containers![0].tabs).toHaveLength(1);
      expect(result.containers![0].title).toBe('Keep');
    });
  });

  describe('legacy dashboard upgrade path', () => {
    // Simulates a dashboard stored in MongoDB before the unified-group changes:
    // containers have `type: 'section'`, no tabs/tabId fields, no collapsible/bordered.
    const legacyDashboard = makeDashboard({
      containers: [
        {
          id: 'section-1',
          title: 'Infrastructure',
          collapsed: false,
        },
        {
          id: 'section-2',
          title: 'Application',
          collapsed: true,
        },
      ],
      tiles: [
        {
          id: 't1',
          containerId: 'section-1',
          x: 0,
          y: 0,
          w: 12,
          h: 4,
        },
        {
          id: 't2',
          containerId: 'section-1',
          x: 0,
          y: 4,
          w: 6,
          h: 4,
        },
        {
          id: 't3',
          containerId: 'section-2',
          x: 0,
          y: 0,
          w: 8,
          h: 6,
        },
      ] as Dashboard['tiles'],
    });

    it('handleAddTab creates 2 tabs and assigns existing tiles to tab 1', () => {
      const { hook, getDashboard } = renderContainersHook(legacyDashboard);
      act(() => {
        hook.result.current.handleAddTab('section-1');
      });

      const result = getDashboard();
      const container = result.containers![0];
      expect(container.tabs).toHaveLength(2);
      // Existing tiles assigned to first tab
      const sectionTiles = result.tiles.filter(
        t => t.containerId === 'section-1',
      );
      expect(sectionTiles.every(t => t.tabId === container.tabs![0].id)).toBe(
        true,
      );
    });

    it('handleRenameContainer works on legacy container', () => {
      const { hook, getDashboard } = renderContainersHook(legacyDashboard);
      act(() => {
        hook.result.current.handleRenameContainer('section-1', 'New Name');
      });

      const result = getDashboard();
      expect(result.containers![0].title).toBe('New Name');
    });

    it('handleToggleCollapsed works on legacy container', () => {
      const { hook, getDashboard } = renderContainersHook(legacyDashboard);
      act(() => {
        hook.result.current.handleToggleCollapsed('section-2');
      });

      const result = getDashboard();
      // Was true, now false
      expect(result.containers![1].collapsed).toBe(false);
    });

    it('handleDeleteContainer ungroups tiles from legacy container', async () => {
      const { hook, getDashboard } = renderContainersHook(legacyDashboard);
      await act(async () => {
        await hook.result.current.handleDeleteContainer('section-1');
      });

      const result = getDashboard();
      // Container removed
      expect(result.containers).toHaveLength(1);
      expect(result.containers![0].id).toBe('section-2');
      // Tiles from section-1 are ungrouped
      const formerTiles = result.tiles.filter(
        t => t.id === 't1' || t.id === 't2',
      );
      expect(formerTiles.every(t => t.containerId === undefined)).toBe(true);
    });
  });
});
