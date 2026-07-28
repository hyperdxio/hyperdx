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
    () => new Set(),
  );

  const handleToggleTileSelect = useCallback((tileId: string) => {
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
    // Clearing the tile selection is a passive side-effect, not a consumption
    // of the key, so don't preventDefault (Mantine's useHotkeys does by
    // default). This listener sits on documentElement and fires before any
    // window-level Esc handler; preventDefaulting here makes a docked overlay
    // that guards on `event.defaultPrevented` — e.g. the tile editor's settings
    // panel — bail out, leaving Esc looking dead while the panel is open.
    ['escape', () => setSelectedTileIds(new Set()), { preventDefault: false }],
  ]);

  return {
    selectedTileIds,
    setSelectedTileIds,
    handleToggleTileSelect,
    handleGroupSelected,
  };
}
