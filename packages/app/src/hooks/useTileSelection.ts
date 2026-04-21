import { useCallback, useState } from 'react';
import produce from 'immer';
import { useHotkeys } from '@mantine/hooks';

import { Dashboard } from '@/dashboard';
import { makeId } from '@/utils/tilePositioning';

export default function useTileSelection({
  dashboard,
  setDashboard,
}: {
  dashboard: Dashboard | undefined;
  setDashboard: (dashboard: Dashboard) => void;
}) {
  const [selectedTileIds, setSelectedTileIds] = useState<Set<string>>(
    new Set(),
  );

  const handleTileSelect = useCallback((tileId: string, shiftKey: boolean) => {
    if (!shiftKey) return;
    setSelectedTileIds(prev => {
      const next = new Set(prev);
      if (next.has(tileId)) next.delete(tileId);
      else next.add(tileId);
      return next;
    });
  }, []);

  const handleGroupSelected = useCallback(() => {
    if (!dashboard || selectedTileIds.size === 0) return;
    const groupId = makeId();
    const tabId = makeId();
    const sourceContainerIds = new Set<string>();
    for (const tile of dashboard.tiles) {
      if (selectedTileIds.has(tile.id) && tile.containerId) {
        sourceContainerIds.add(tile.containerId);
      }
    }
    setDashboard(
      produce(dashboard, draft => {
        if (!draft.containers) draft.containers = [];
        draft.containers.push({
          id: groupId,
          title: 'New Group',
          collapsed: false,
          tabs: [{ id: tabId, title: 'New Group' }],
          activeTabId: tabId,
        });
        for (const tile of draft.tiles) {
          if (selectedTileIds.has(tile.id)) {
            tile.containerId = groupId;
            tile.tabId = tabId;
          }
        }
        if (sourceContainerIds.size > 0) {
          draft.containers = draft.containers.filter(
            c =>
              !sourceContainerIds.has(c.id) ||
              draft.tiles.some(t => t.containerId === c.id),
          );
        }
      }),
    );
    setSelectedTileIds(new Set());
  }, [dashboard, selectedTileIds, setDashboard]);

  useHotkeys([
    [
      'mod+g',
      e => {
        e.preventDefault();
        handleGroupSelected();
      },
    ],
    ['escape', () => setSelectedTileIds(new Set())],
  ]);

  return {
    selectedTileIds,
    setSelectedTileIds,
    handleTileSelect,
    handleGroupSelected,
  };
}
