import { useCallback } from 'react';
import produce from 'immer';
import { arrayMove } from '@dnd-kit/sortable';
import { Text } from '@mantine/core';

import { Dashboard } from '@/dashboard';
import { makeId } from '@/utils/tilePositioning';

type ConfirmFn = (
  message: React.ReactNode,
  confirmLabel?: string,
  options?: { variant?: 'primary' | 'danger' },
) => Promise<boolean>;

export default function useDashboardContainers({
  dashboard,
  setDashboard,
  confirm,
}: {
  dashboard: Dashboard | undefined;
  setDashboard: (dashboard: Dashboard) => void;
  confirm: ConfirmFn;
}) {
  const handleAddContainer = useCallback(() => {
    if (!dashboard) return;
    setDashboard(
      produce(dashboard, draft => {
        if (!draft.containers) draft.containers = [];
        const containerId = makeId();
        const tabId = makeId();
        draft.containers.push({
          id: containerId,
          title: 'New Group',
          collapsed: false,
          tabs: [{ id: tabId, title: 'New Group' }],
          activeTabId: tabId,
        });
      }),
    );
  }, [dashboard, setDashboard]);

  const handleToggleCollapsed = useCallback(
    (containerId: string) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          const container = draft.containers?.find(s => s.id === containerId);
          if (container) container.collapsed = !container.collapsed;
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const handleRenameContainer = useCallback(
    (containerId: string, newTitle: string) => {
      if (!dashboard || !newTitle.trim()) return;
      setDashboard(
        produce(dashboard, draft => {
          const container = draft.containers?.find(s => s.id === containerId);
          if (container) {
            container.title = newTitle.trim();
            // Sync tabs[0].title when there is 1 tab (they share the header)
            if (container.tabs?.length === 1) {
              container.tabs[0].title = newTitle.trim();
            }
          }
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const handleDeleteContainer = useCallback(
    async (containerId: string) => {
      if (!dashboard) return;
      const container = dashboard.containers?.find(c => c.id === containerId);
      const tileCount = dashboard.tiles.filter(
        t => t.containerId === containerId,
      ).length;
      const label = container?.title ?? 'this group';

      const message =
        tileCount > 0 ? (
          <>
            Delete{' '}
            <Text component="span" fw={700}>
              {label}
            </Text>
            ?{' '}
            {`${tileCount} tile${tileCount > 1 ? 's' : ''} will become ungrouped.`}
          </>
        ) : (
          <>
            Delete{' '}
            <Text component="span" fw={700}>
              {label}
            </Text>
            ?
          </>
        );

      const confirmed = await confirm(message, 'Delete', {
        variant: 'danger',
      });
      if (!confirmed) return;

      setDashboard(
        produce(dashboard, draft => {
          const allContainerIds = new Set(
            draft.containers?.map(c => c.id) ?? [],
          );
          let maxUngroupedY = 0;
          for (const tile of draft.tiles) {
            if (!tile.containerId || !allContainerIds.has(tile.containerId)) {
              maxUngroupedY = Math.max(maxUngroupedY, tile.y + tile.h);
            }
          }

          for (const tile of draft.tiles) {
            if (tile.containerId === containerId) {
              tile.y += maxUngroupedY;
              delete tile.containerId;
              delete tile.tabId;
            }
          }

          draft.containers = draft.containers?.filter(
            s => s.id !== containerId,
          );
        }),
      );
    },
    [dashboard, setDashboard, confirm],
  );

  const handleReorderContainers = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (!dashboard?.containers) return;
      setDashboard(
        produce(dashboard, draft => {
          if (draft.containers) {
            draft.containers = arrayMove(draft.containers, fromIndex, toIndex);
          }
        }),
      );
    },
    [dashboard, setDashboard],
  );

  // --- Tab management ---

  const handleAddTab = useCallback(
    (containerId: string) => {
      if (!dashboard) return;
      const container = dashboard.containers?.find(c => c.id === containerId);
      if (!container) return;
      const existingTabs = container.tabs ?? [];

      setDashboard(
        produce(dashboard, draft => {
          const c = draft.containers?.find(c => c.id === containerId);
          if (!c) return;

          if (existingTabs.length === 1) {
            // Group already has 1 tab (the default); just add a second tab
            const newTabId = makeId();
            if (!c.tabs) c.tabs = [];
            c.tabs.push({ id: newTabId, title: 'New Tab' });
            c.activeTabId = newTabId;
            // Ensure existing tiles are assigned to the first tab
            const firstTabId = existingTabs[0].id;
            for (const tile of draft.tiles) {
              if (tile.containerId === containerId && !tile.tabId) {
                tile.tabId = firstTabId;
              }
            }
          } else if (existingTabs.length === 0) {
            // Legacy container with no tabs: create 2 tabs
            const tab1Id = makeId();
            const tab2Id = makeId();
            c.tabs = [
              { id: tab1Id, title: 'Tab 1' },
              { id: tab2Id, title: 'Tab 2' },
            ];
            c.activeTabId = tab1Id;
            for (const tile of draft.tiles) {
              if (tile.containerId === containerId) {
                tile.tabId = tab1Id;
              }
            }
          } else {
            // Already has 2+ tabs, add one more
            if (!c.tabs) c.tabs = [];
            const newTabId = makeId();
            c.tabs.push({
              id: newTabId,
              title: `Tab ${existingTabs.length + 1}`,
            });
            c.activeTabId = newTabId;
          }
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const handleRenameTab = useCallback(
    (containerId: string, tabId: string, newTitle: string) => {
      if (!dashboard || !newTitle.trim()) return;
      setDashboard(
        produce(dashboard, draft => {
          const container = draft.containers?.find(c => c.id === containerId);
          const tab = container?.tabs?.find(t => t.id === tabId);
          if (tab) {
            tab.title = newTitle.trim();
            // Keep container.title in sync when renaming the first (or only) tab
            if (container && container.tabs?.[0]?.id === tabId) {
              container.title = newTitle.trim();
            }
          }
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const handleDeleteTab = useCallback(
    (containerId: string, tabId: string) => {
      if (!dashboard) return;
      const container = dashboard.containers?.find(c => c.id === containerId);
      if (!container?.tabs) return;
      const remaining = container.tabs.filter(t => t.id !== tabId);

      setDashboard(
        produce(dashboard, draft => {
          const c = draft.containers?.find(c => c.id === containerId);
          if (!c?.tabs) return;

          if (remaining.length <= 1) {
            // Keep the 1 remaining tab (don't clear tabs array)
            const keepTab = remaining[0];
            c.tabs = remaining;
            c.activeTabId = keepTab?.id;
            // Move tiles from deleted tab to the remaining tab
            for (const tile of draft.tiles) {
              if (tile.containerId === containerId && tile.tabId === tabId) {
                tile.tabId = keepTab?.id;
              }
            }
          } else {
            const targetTabId = remaining[0].id;
            // Move tiles from deleted tab to first remaining tab
            for (const tile of draft.tiles) {
              if (tile.containerId === containerId && tile.tabId === tabId) {
                tile.tabId = targetTabId;
              }
            }
            c.tabs = c.tabs.filter(t => t.id !== tabId);
            if (c.activeTabId === tabId) {
              c.activeTabId = targetTabId;
            }
          }
        }),
      );
    },
    [dashboard, setDashboard],
  );

  // Intentionally persisted to server (same as collapsed state) — shared
  // across all viewers. If user-local tab state is needed later, move to
  // useState/localStorage instead.
  const handleTabChange = useCallback(
    (containerId: string, tabId: string) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          const container = draft.containers?.find(c => c.id === containerId);
          if (container) container.activeTabId = tabId;
        }),
      );
    },
    [dashboard, setDashboard],
  );

  return {
    handleAddContainer,
    handleToggleCollapsed,
    handleRenameContainer,
    handleDeleteContainer,
    handleReorderContainers,
    handleAddTab,
    handleRenameTab,
    handleDeleteTab,
    handleTabChange,
  };
}
