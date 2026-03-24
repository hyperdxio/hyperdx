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

  // Creates a 'section' type container (not 'group') intentionally.
  // Sections are collapsible and are the most common container type for
  // organizing tiles on a dashboard. The function name reflects the user
  // action (grouping selected tiles) rather than the container type created.
  const handleGroupSelected = useCallback(() => {
    if (!dashboard || selectedTileIds.size === 0) return;
    const groupId = makeId();
    setDashboard(
      produce(dashboard, draft => {
        if (!draft.containers) draft.containers = [];
        draft.containers.push({
          id: groupId,
          type: 'section',
          title: 'New Section',
          collapsed: false,
        });
        for (const tile of draft.tiles) {
          if (selectedTileIds.has(tile.id)) {
            tile.containerId = groupId;
            delete tile.tabId; // Clear tab assignment from previous group
          }
        }
      }),
    );
    setSelectedTileIds(new Set());
  }, [dashboard, selectedTileIds, setDashboard]);

  // Cmd+G / Ctrl+G to group selected tiles
  useHotkeys([
    [
      'mod+g',
      e => {
        e.preventDefault();
        handleGroupSelected();
      },
    ],
    // Escape to clear selection
    ['escape', () => setSelectedTileIds(new Set())],
  ]);

  return {
    selectedTileIds,
    setSelectedTileIds,
    handleTileSelect,
    handleGroupSelected,
  };
}
