import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { DashboardGrid } from '../DashboardGrid';

const renderDashboardGrid = (
  overrides: Partial<React.ComponentProps<typeof DashboardGrid>> = {},
) => {
  const onGroupSelected = jest.fn();
  const setSelectedTileIds = jest.fn();
  const onAddTile = jest.fn();
  const onAddContainer = jest.fn();

  renderWithMantine(
    <DashboardGrid
      canRenderDashboard={false}
      hasTiles={false}
      containers={[]}
      ungroupedTiles={[]}
      selectedTileIds={new Set()}
      setSelectedTileIds={setSelectedTileIds}
      onGroupSelected={onGroupSelected}
      onReorderContainers={jest.fn()}
      onUngroupedLayoutChange={jest.fn()}
      renderTileComponent={jest.fn()}
      tileToLayoutItem={jest.fn()}
      tilesByContainerId={new Map()}
      isContainerCollapsed={jest.fn()}
      getActiveTabId={jest.fn()}
      alertingTabIdsByContainer={new Map()}
      onToggleCollapse={jest.fn()}
      onToggleDefaultCollapsed={jest.fn()}
      onToggleCollapsible={jest.fn()}
      onToggleBordered={jest.fn()}
      onDeleteContainer={jest.fn()}
      onAddTile={onAddTile}
      onAddContainer={onAddContainer}
      onAddTab={jest.fn()}
      onRenameTab={jest.fn()}
      onDeleteTab={jest.fn()}
      onRenameContainer={jest.fn()}
      onTabChange={jest.fn()}
      makeLayoutChangeHandler={jest.fn()}
      {...overrides}
    />,
  );

  return {
    onGroupSelected,
    setSelectedTileIds,
    onAddTile,
    onAddContainer,
  };
};

describe('DashboardGrid', () => {
  it('shows selected tile actions and invokes callbacks', async () => {
    const user = userEvent.setup();
    const { onGroupSelected, setSelectedTileIds } = renderDashboardGrid({
      selectedTileIds: new Set(['tile-1', 'tile-2']),
    });

    expect(screen.getByText('2 tiles selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Group' }));
    expect(onGroupSelected).toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(setSelectedTileIds).toHaveBeenCalledWith(new Set());
  });

  it('opens the add menu and invokes add callbacks', async () => {
    const user = userEvent.setup();
    const { onAddTile, onAddContainer } = renderDashboardGrid();

    await user.click(screen.getByTestId('add-dropdown-button'));
    await user.click(await screen.findByText('New Tile'));
    expect(onAddTile).toHaveBeenCalledWith();

    await user.click(screen.getByTestId('add-dropdown-button'));
    await user.click(await screen.findByText('New Group'));
    expect(onAddContainer).toHaveBeenCalled();
  });
});
