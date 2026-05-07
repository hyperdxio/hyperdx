import { Dispatch, SetStateAction } from 'react';
import RGL, { WidthProvider } from 'react-grid-layout';
import { ErrorBoundary } from 'react-error-boundary';
import { DashboardContainer as DashboardContainerSchema } from '@hyperdx/common-utils/dist/types';
import { Box, Button, Flex, Menu, Paper, Text } from '@mantine/core';
import {
  IconChartBar,
  IconPlus,
  IconSquaresDiagonal,
} from '@tabler/icons-react';

import { SortableContainerWrapper } from '@/components/DashboardDndComponents';
import {
  DashboardDndProvider,
  type DragHandleProps,
} from '@/components/DashboardDndContext';
import { type Tile } from '@/dashboard';
import { type TabDeleteAction } from '@/hooks/useDashboardContainers';

import { DashboardContainerRow } from './DashboardContainerRow';

const ReactGridLayout = WidthProvider(RGL);

type DashboardGridProps = {
  canRenderDashboard: boolean;
  hasTiles: boolean;
  containers: DashboardContainerSchema[];
  ungroupedTiles: Tile[];
  selectedTileIds: Set<string>;
  setSelectedTileIds: Dispatch<SetStateAction<Set<string>>>;
  onGroupSelected: () => void;
  onReorderContainers: (fromIndex: number, toIndex: number) => void;
  onUngroupedLayoutChange: (newLayout: RGL.Layout[]) => void;
  renderTileComponent: (tile: Tile) => React.ReactNode;
  tileToLayoutItem: (tile: Tile) => RGL.Layout;
  tilesByContainerId: Map<string, Tile[]>;
  isContainerCollapsed: (container: DashboardContainerSchema) => boolean;
  getActiveTabId: (container: DashboardContainerSchema) => string | undefined;
  alertingTabIdsByContainer: Map<string, Set<string>>;
  onToggleCollapse: (containerId: string) => void;
  onToggleDefaultCollapsed: (containerId: string) => void;
  onToggleCollapsible: (containerId: string) => void;
  onToggleBordered: (containerId: string) => void;
  onDeleteContainer: (
    containerId: string,
    action: 'ungroup' | 'delete',
  ) => void;
  onAddTile: (containerId?: string, tabId?: string) => void;
  onAddContainer: () => void;
  onAddTab: (containerId: string) => string | undefined;
  onRenameTab: (containerId: string, tabId: string, title: string) => void;
  onDeleteTab: (
    containerId: string,
    tabId: string,
    action: TabDeleteAction,
  ) => void;
  onRenameContainer: (containerId: string, title: string) => void;
  onTabChange: (containerId: string, tabId: string) => void;
  makeLayoutChangeHandler: (tiles: Tile[]) => (newLayout: RGL.Layout[]) => void;
};

export function DashboardGrid({
  canRenderDashboard,
  hasTiles,
  containers,
  ungroupedTiles,
  selectedTileIds,
  setSelectedTileIds,
  onGroupSelected,
  onReorderContainers,
  onUngroupedLayoutChange,
  renderTileComponent,
  tileToLayoutItem,
  tilesByContainerId,
  isContainerCollapsed,
  getActiveTabId,
  alertingTabIdsByContainer,
  onToggleCollapse,
  onToggleDefaultCollapsed,
  onToggleCollapsible,
  onToggleBordered,
  onDeleteContainer,
  onAddTile,
  onAddContainer,
  onAddTab,
  onRenameTab,
  onDeleteTab,
  onRenameContainer,
  onTabChange,
  makeLayoutChangeHandler,
}: DashboardGridProps) {
  return (
    <>
      {selectedTileIds.size > 0 && (
        <Paper p="xs" mt="sm" withBorder>
          <Flex align="center" gap="sm">
            <Text size="sm">
              {selectedTileIds.size} tile{selectedTileIds.size > 1 ? 's' : ''}{' '}
              selected
            </Text>
            <Button
              size="xs"
              variant="primary"
              onClick={onGroupSelected}
              title="Group selected tiles (Cmd+G)"
            >
              Group
            </Button>
            <Button
              size="xs"
              variant="secondary"
              onClick={() => setSelectedTileIds(new Set())}
            >
              Clear
            </Button>
          </Flex>
        </Paper>
      )}
      <Box mt="sm">
        {canRenderDashboard ? (
          <ErrorBoundary
            onError={console.error}
            fallback={
              <div className="text-danger px-2 py-1 m-2 fs-7 font-monospace bg-danger-transparent">
                An error occurred while rendering the dashboard.
              </div>
            }
          >
            <DashboardDndProvider
              containers={containers}
              onReorderContainers={onReorderContainers}
            >
              {ungroupedTiles.length > 0 && (
                <ReactGridLayout
                  layout={ungroupedTiles.map(tileToLayoutItem)}
                  containerPadding={[0, 0]}
                  onLayoutChange={onUngroupedLayoutChange}
                  cols={24}
                  rowHeight={32}
                >
                  {ungroupedTiles.map(renderTileComponent)}
                </ReactGridLayout>
              )}
              {containers.map(container => (
                <SortableContainerWrapper
                  key={container.id}
                  containerId={container.id}
                  containerTitle={container.title}
                >
                  {(dragHandleProps: DragHandleProps) => (
                    <DashboardContainerRow
                      container={container}
                      containerTiles={
                        tilesByContainerId.get(container.id) ?? []
                      }
                      isCollapsed={isContainerCollapsed(container)}
                      activeTabId={getActiveTabId(container)}
                      alertingTabIds={alertingTabIdsByContainer.get(
                        container.id,
                      )}
                      onToggleCollapse={() => onToggleCollapse(container.id)}
                      onToggleDefaultCollapsed={() =>
                        onToggleDefaultCollapsed(container.id)
                      }
                      onToggleCollapsible={() =>
                        onToggleCollapsible(container.id)
                      }
                      onToggleBordered={() => onToggleBordered(container.id)}
                      onDeleteContainer={action =>
                        onDeleteContainer(container.id, action)
                      }
                      onAddTile={onAddTile}
                      onAddTab={() => {
                        const newTabId = onAddTab(container.id);
                        if (newTabId) onTabChange(container.id, newTabId);
                      }}
                      onRenameTab={(tabId, title) =>
                        onRenameTab(container.id, tabId, title)
                      }
                      onDeleteTab={(tabId, action) =>
                        onDeleteTab(container.id, tabId, action)
                      }
                      onRenameContainer={title =>
                        onRenameContainer(container.id, title)
                      }
                      onTabChange={tabId => onTabChange(container.id, tabId)}
                      dragHandleProps={dragHandleProps}
                      makeLayoutChangeHandler={makeLayoutChangeHandler}
                      tileToLayoutItem={tileToLayoutItem}
                      renderTileComponent={renderTileComponent}
                    />
                  )}
                </SortableContainerWrapper>
              ))}
            </DashboardDndProvider>
          </ErrorBoundary>
        ) : null}
      </Box>
      <Menu position="top" width={200}>
        <Menu.Target>
          <Button
            data-testid="add-dropdown-button"
            variant={!hasTiles ? 'primary' : 'secondary'}
            mt="sm"
            fw={400}
            w="100%"
            leftSection={<IconPlus size={16} />}
          >
            Add
          </Button>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            data-testid="add-new-tile-menu-item"
            leftSection={<IconChartBar size={16} />}
            onClick={() => onAddTile()}
          >
            New Tile
          </Menu.Item>
          <Menu.Divider />
          <Menu.Item
            data-testid="add-new-group-menu-item"
            leftSection={<IconSquaresDiagonal size={16} />}
            onClick={onAddContainer}
          >
            New Group
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </>
  );
}
