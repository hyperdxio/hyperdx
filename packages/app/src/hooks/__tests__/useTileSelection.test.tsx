import { act, renderHook } from '@testing-library/react';

import { Dashboard } from '@/dashboard';

import useTileSelection from '../useTileSelection';

function renderSelectionHook(dashboard: Dashboard) {
  let current = dashboard;
  const setDashboard = jest.fn((d: Dashboard) => {
    current = d;
  });
  const hook = renderHook(() =>
    useTileSelection({ dashboard: current, setDashboard }),
  );
  return { hook, setDashboard, getDashboard: () => current };
}

describe('useTileSelection — handleGroupSelected', () => {
  it('deletes a source group that is emptied when all its tiles move to the new group', () => {
    const dashboard: Dashboard = {
      name: 'Test',
      containers: [
        {
          id: 'c-source',
          title: 'Source',
          collapsed: false,
          tabs: [{ id: 'tab-source', title: 'Source' }],
          activeTabId: 'tab-source',
        },
      ],
      tiles: [
        {
          id: 't1',
          containerId: 'c-source',
          tabId: 'tab-source',
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        },
        {
          id: 't2',
          containerId: 'c-source',
          tabId: 'tab-source',
          x: 6,
          y: 0,
          w: 6,
          h: 4,
        },
      ],
    } as Dashboard;

    const { hook, getDashboard } = renderSelectionHook(dashboard);
    act(() => {
      hook.result.current.setSelectedTileIds(new Set(['t1', 't2']));
    });
    act(() => {
      hook.result.current.handleGroupSelected();
    });

    const result = getDashboard();
    expect(result.containers).toHaveLength(1);
    expect(result.containers![0].id).not.toBe('c-source');
    expect(result.tiles.every(t => t.containerId !== 'c-source')).toBe(true);
  });

  it('keeps a source group that still has remaining tiles', () => {
    const dashboard: Dashboard = {
      name: 'Test',
      containers: [
        {
          id: 'c-source',
          title: 'Source',
          collapsed: false,
          tabs: [{ id: 'tab-source', title: 'Source' }],
          activeTabId: 'tab-source',
        },
      ],
      tiles: [
        {
          id: 't1',
          containerId: 'c-source',
          tabId: 'tab-source',
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        },
        {
          id: 't2',
          containerId: 'c-source',
          tabId: 'tab-source',
          x: 6,
          y: 0,
          w: 6,
          h: 4,
        },
      ],
    } as Dashboard;

    const { hook, getDashboard } = renderSelectionHook(dashboard);
    act(() => {
      hook.result.current.setSelectedTileIds(new Set(['t1']));
    });
    act(() => {
      hook.result.current.handleGroupSelected();
    });

    const result = getDashboard();
    expect(result.containers).toHaveLength(2);
    expect(result.containers!.some(c => c.id === 'c-source')).toBe(true);
    expect(
      result.tiles.find(t => t.id === 't2')!.containerId,
    ).toBe('c-source');
  });

  it('does not delete unrelated empty containers', () => {
    const dashboard: Dashboard = {
      name: 'Test',
      containers: [
        {
          id: 'c-empty',
          title: 'Empty',
          collapsed: false,
          tabs: [{ id: 'tab-empty', title: 'Empty' }],
          activeTabId: 'tab-empty',
        },
      ],
      tiles: [
        {
          id: 't1',
          x: 0,
          y: 0,
          w: 6,
          h: 4,
        },
      ],
    } as Dashboard;

    const { hook, getDashboard } = renderSelectionHook(dashboard);
    act(() => {
      hook.result.current.setSelectedTileIds(new Set(['t1']));
    });
    act(() => {
      hook.result.current.handleGroupSelected();
    });

    const result = getDashboard();
    expect(result.containers!.some(c => c.id === 'c-empty')).toBe(true);
  });
});
