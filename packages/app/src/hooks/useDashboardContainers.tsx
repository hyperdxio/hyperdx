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
  const handleAddContainer = useCallback(
    (type: 'section' | 'group' = 'section') => {
      if (!dashboard) return;
      const titles: Record<string, string> = {
        section: 'New Section',
        group: 'New Group',
      };
      setDashboard(
        produce(dashboard, draft => {
          if (!draft.containers) draft.containers = [];
          const containerId = makeId();
          if (type === 'group') {
            const tabId = makeId();
            draft.containers.push({
              id: containerId,
              type,
              title: titles[type],
              collapsed: false,
              tabs: [{ id: tabId, title: titles[type] }],
              activeTabId: tabId,
            });
          } else {
            draft.containers.push({
              id: containerId,
              type,
              title: titles[type],
              collapsed: false,
            });
          }
        }),
      );
    },
    [dashboard, setDashboard],
  );

  // Intentionally persists collapsed state to the server via setDashboard
  // (same pattern as tile drag/resize). This matches Grafana and Kibana
  // behavior where collapsed state is saved with the dashboard for all viewers.
  const handleToggleSection = useCallback(
    (containerId: string) => {
      if (!dashboard) return;
      setDashboard(
        produce(dashboard, draft => {
          const section = draft.containers?.find(s => s.id === containerId);
          if (section) section.collapsed = !section.collapsed;
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const handleRenameSection = useCallback(
    (containerId: string, newTitle: string) => {
      if (!dashboard || !newTitle.trim()) return;
      setDashboard(
        produce(dashboard, draft => {
          const section = draft.containers?.find(s => s.id === containerId);
          if (section) {
            section.title = newTitle.trim();
            // For groups with 1 tab, sync tabs[0].title (they share the header)
            if (section.type === 'group' && section.tabs?.length === 1) {
              section.tabs[0].title = newTitle.trim();
            }
          }
        }),
      );
    },
    [dashboard, setDashboard],
  );

  const handleDeleteSection = useCallback(
    async (containerId: string) => {
      if (!dashboard) return;
      const container = dashboard.containers?.find(c => c.id === containerId);
      const tileCount = dashboard.tiles.filter(
        t => t.containerId === containerId,
      ).length;
      const label = container?.title ?? 'this section';

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
          const allSectionIds = new Set(draft.containers?.map(c => c.id) ?? []);
          let maxUngroupedY = 0;
          for (const tile of draft.tiles) {
            if (!tile.containerId || !allSectionIds.has(tile.containerId)) {
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

  const handleReorderSections = useCallback(
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
            // Legacy group with no tabs: create 2 tabs
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
          if (tab) tab.title = newTitle.trim();
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
  // across all viewers, matching Grafana/Kibana behavior where active tab
  // is part of the dashboard layout definition. If user-local tab state
  // is needed later, move to useState/localStorage instead.
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
    handleToggleSection,
    handleRenameSection,
    handleDeleteSection,
    handleReorderSections,
    handleAddTab,
    handleRenameTab,
    handleDeleteTab,
    handleTabChange,
  };
}
