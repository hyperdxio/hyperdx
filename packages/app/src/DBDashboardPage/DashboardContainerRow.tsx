import { useMemo } from 'react';
import RGL, { WidthProvider } from 'react-grid-layout';
import { DashboardContainer as DashboardContainerSchema } from '@hyperdx/common-utils/dist/types';

import DashboardContainer from '@/components/DashboardContainer';
import {
  EmptyContainerPlaceholder,
} from '@/components/DashboardDndComponents';
import { type DragHandleProps } from '@/components/DashboardDndContext';
import { type Tile } from '@/dashboard';
import { type TabDeleteAction } from '@/hooks/useDashboardContainers';

const ReactGridLayout = WidthProvider(RGL);

type DashboardContainerRowProps = {
  container: DashboardContainerSchema;
  containerTiles: Tile[];
  isCollapsed: boolean;
  activeTabId: string | undefined;
  alertingTabIds?: Set<string>;
  onToggleCollapse: () => void;
  onToggleDefaultCollapsed: () => void;
  onToggleCollapsible: () => void;
  onToggleBordered: () => void;
  onDeleteContainer: (action: 'ungroup' | 'delete') => void;
  onAddTile: (containerId: string, tabId?: string) => void;
  onAddTab: () => void;
  onRenameTab: (tabId: string, newTitle: string) => void;
  onDeleteTab: (tabId: string, action: TabDeleteAction) => void;
  onRenameContainer: (newTitle: string) => void;
  onTabChange: (tabId: string) => void;
  dragHandleProps: DragHandleProps;
  makeLayoutChangeHandler: (tiles: Tile[]) => (newLayout: RGL.Layout[]) => void;
  tileToLayoutItem: (tile: Tile) => RGL.Layout;
  renderTileComponent: (tile: Tile) => React.ReactNode;
};

export function DashboardContainerRow({
  container,
  containerTiles,
  isCollapsed,
  activeTabId,
  alertingTabIds,
  onToggleCollapse,
  onToggleDefaultCollapsed,
  onToggleCollapsible,
  onToggleBordered,
  onDeleteContainer,
  onAddTile,
  onAddTab,
  onRenameTab,
  onDeleteTab,
  onRenameContainer,
  onTabChange,
  dragHandleProps,
  makeLayoutChangeHandler,
  tileToLayoutItem,
  renderTileComponent,
}: DashboardContainerRowProps) {
  const groupTabs = container.tabs ?? [];
  const hasTabs = groupTabs.length >= 2;
  // Tiles actually rendered inside RGL (active tab only for multi-tab
  // containers). Handler must be built from these so RGL's `newLayout` and our
  // `currentLayout` have matching sizes - otherwise every drag triggers a
  // bogus diff + setDashboard write.
  const visibleTiles = hasTabs
    ? containerTiles.filter(t => t.tabId === activeTabId)
    : containerTiles;
  const layoutChangeHandler = useMemo(
    () => makeLayoutChangeHandler(visibleTiles),
    [makeLayoutChangeHandler, visibleTiles],
  );

  return (
    <DashboardContainer
      container={container}
      collapsed={isCollapsed}
      defaultCollapsed={container.collapsed ?? false}
      onToggle={onToggleCollapse}
      onToggleDefaultCollapsed={onToggleDefaultCollapsed}
      onToggleCollapsible={onToggleCollapsible}
      onToggleBordered={onToggleBordered}
      onDelete={onDeleteContainer}
      tileCount={containerTiles.length}
      onAddTile={() =>
        onAddTile(container.id, hasTabs ? activeTabId : undefined)
      }
      activeTabId={activeTabId}
      onTabChange={onTabChange}
      onAddTab={onAddTab}
      onRenameTab={onRenameTab}
      onDeleteTab={onDeleteTab}
      onRename={onRenameContainer}
      dragHandleProps={dragHandleProps}
      alertingTabIds={alertingTabIds}
    >
      {(currentTabId: string | undefined) => {
        const visibleTiles = currentTabId
          ? containerTiles.filter(t => t.tabId === currentTabId)
          : containerTiles;
        const visibleIsEmpty = visibleTiles.length === 0;
        return (
          <EmptyContainerPlaceholder
            containerId={currentTabId ?? container.id}
            isEmpty={visibleIsEmpty}
            onAddTile={() => onAddTile(container.id, currentTabId)}
          >
            {visibleTiles.length > 0 && (
              <ReactGridLayout
                layout={visibleTiles.map(tileToLayoutItem)}
                containerPadding={[0, 0]}
                onLayoutChange={layoutChangeHandler}
                cols={24}
                rowHeight={32}
              >
                {visibleTiles.map(renderTileComponent)}
              </ReactGridLayout>
            )}
          </EmptyContainerPlaceholder>
        );
      }}
    </DashboardContainer>
  );
}
