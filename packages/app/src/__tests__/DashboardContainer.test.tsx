import * as React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import DashboardContainer from '@/components/DashboardContainer';

function renderDashboardContainer(
  props: Partial<React.ComponentProps<typeof DashboardContainer>> = {},
) {
  const defaults: React.ComponentProps<typeof DashboardContainer> = {
    container: {
      id: 'g1',
      title: 'Test Group',
      collapsed: false,
      tabs: [{ id: 'tab-1', title: 'Tab One' }],
    },
    collapsed: false,
    defaultCollapsed: false,
    onToggle: jest.fn(),
    children: () => <div data-testid="group-children">Content</div>,
    ...props,
  };
  return render(
    <MantineProvider>
      <DashboardContainer {...defaults} />
    </MantineProvider>,
  );
}

describe('DashboardContainer', () => {
  describe('collapsible behavior', () => {
    it('renders chevron when collapsible (default)', () => {
      renderDashboardContainer();
      expect(screen.getByTestId('group-chevron-g1')).toBeInTheDocument();
    });

    it('hides chevron when collapsible is false', () => {
      renderDashboardContainer({
        container: {
          id: 'g1',
          title: 'Test',
          collapsed: false,
          collapsible: false,
          tabs: [{ id: 'tab-1', title: 'Tab One' }],
        },
      });
      expect(screen.queryByTestId('group-chevron-g1')).not.toBeInTheDocument();
    });

    it('shows children when expanded', () => {
      renderDashboardContainer({ collapsed: false });
      expect(screen.getByTestId('group-children')).toBeInTheDocument();
    });

    it('hides children when collapsed', () => {
      renderDashboardContainer({ collapsed: true });
      expect(screen.queryByTestId('group-children')).not.toBeInTheDocument();
    });

    it('calls onToggle when chevron is clicked', () => {
      const onToggle = jest.fn();
      renderDashboardContainer({ onToggle });
      fireEvent.click(screen.getByTestId('group-chevron-g1'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('bordered behavior', () => {
    it('renders border by default', () => {
      renderDashboardContainer();
      const container = screen.getByTestId('group-container-g1');
      expect(container.style.border).toContain('1px solid');
    });

    it('hides border when bordered is false', () => {
      renderDashboardContainer({
        container: {
          id: 'g1',
          title: 'Test',
          collapsed: false,
          bordered: false,
          tabs: [{ id: 'tab-1', title: 'Tab One' }],
        },
      });
      const container = screen.getByTestId('group-container-g1');
      expect(container.style.border).toBe('');
    });
  });

  describe('collapsed tab summary', () => {
    it('shows all tab names when collapsed with multiple tabs', () => {
      renderDashboardContainer({
        collapsed: true,
        container: {
          id: 'g1',
          title: 'My Group',
          collapsed: false,
          tabs: [
            { id: 'tab-1', title: 'Overview' },
            { id: 'tab-2', title: 'Details' },
            { id: 'tab-3', title: 'Logs' },
          ],
        },
      });
      expect(screen.getByText('Overview | Details | Logs')).toBeInTheDocument();
    });

    it('does not show tab summary when expanded', () => {
      renderDashboardContainer({
        collapsed: false,
        container: {
          id: 'g1',
          title: 'My Group',
          collapsed: false,
          tabs: [
            { id: 'tab-1', title: 'Overview' },
            { id: 'tab-2', title: 'Details' },
          ],
        },
      });
      expect(screen.queryByText('Overview | Details')).not.toBeInTheDocument();
    });

    it('shows header title for single-tab collapsed group (no pipe summary)', () => {
      renderDashboardContainer({
        collapsed: true,
        container: {
          id: 'g1',
          title: 'My Group',
          collapsed: false,
          tabs: [{ id: 'tab-1', title: 'Only Tab' }],
        },
      });
      // Single tab: shows header title, no pipe-separated summary
      expect(screen.getByText('Only Tab')).toBeInTheDocument();
      expect(screen.queryByText(/\|/)).not.toBeInTheDocument();
    });
  });

  describe('overflow menu conditional rendering', () => {
    // Mantine Menu renders dropdown items in a portal only when opened,
    // so we test the negative case (items that should NOT be in the DOM).
    it('hides default-collapsed toggle when collapsible is false', () => {
      renderDashboardContainer({
        onToggleDefaultCollapsed: jest.fn(),
        container: {
          id: 'g1',
          title: 'Test',
          collapsed: false,
          collapsible: false,
          tabs: [{ id: 'tab-1', title: 'Tab' }],
        },
      });
      expect(
        screen.queryByTestId('group-toggle-default-g1'),
      ).not.toBeInTheDocument();
    });
  });

  describe('tab bar', () => {
    it('renders tab bar with 2+ tabs when expanded', () => {
      renderDashboardContainer({
        container: {
          id: 'g1',
          title: 'Group',
          collapsed: false,
          tabs: [
            { id: 'tab-1', title: 'First' },
            { id: 'tab-2', title: 'Second' },
          ],
          activeTabId: 'tab-1',
        },
        activeTabId: 'tab-1',
        onTabChange: jest.fn(),
      });
      expect(screen.getByRole('tab', { name: 'First' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Second' })).toBeInTheDocument();
    });

    it('renders plain header with single tab', () => {
      renderDashboardContainer({
        container: {
          id: 'g1',
          title: 'Group',
          collapsed: false,
          tabs: [{ id: 'tab-1', title: 'Only' }],
        },
      });
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
      expect(screen.getByText('Only')).toBeInTheDocument();
    });
  });

  describe('tab delete', () => {
    const twoTabProps = {
      container: {
        id: 'g1',
        title: 'Group',
        collapsed: false,
        tabs: [
          { id: 'tab-1', title: 'First' },
          { id: 'tab-2', title: 'Second' },
        ],
        activeTabId: 'tab-1',
      },
      activeTabId: 'tab-1' as const,
      onTabChange: jest.fn(),
    };

    it('opens delete modal when tab delete button is clicked', async () => {
      const onDeleteTab = jest.fn();
      renderDashboardContainer({ onDeleteTab, ...twoTabProps });

      const firstTab = screen.getByRole('tab', { name: 'First' });
      fireEvent.mouseEnter(firstTab);
      fireEvent.click(screen.getByTestId('tab-delete-tab-1'));

      expect(
        await screen.findByTestId('tab-delete-confirm'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('tab-delete-move')).toBeInTheDocument();
    });

    it('calls onDeleteTab with "delete" when Delete Tab & Tiles is clicked', async () => {
      const onDeleteTab = jest.fn();
      renderDashboardContainer({ onDeleteTab, ...twoTabProps });

      const firstTab = screen.getByRole('tab', { name: 'First' });
      fireEvent.mouseEnter(firstTab);
      fireEvent.click(screen.getByTestId('tab-delete-tab-1'));
      fireEvent.click(await screen.findByTestId('tab-delete-confirm'));

      expect(onDeleteTab).toHaveBeenCalledWith('tab-1', 'delete');
    });

    it('calls onDeleteTab with "move" when Move Tiles is clicked', async () => {
      const onDeleteTab = jest.fn();
      renderDashboardContainer({ onDeleteTab, ...twoTabProps });

      const firstTab = screen.getByRole('tab', { name: 'First' });
      fireEvent.mouseEnter(firstTab);
      fireEvent.click(screen.getByTestId('tab-delete-tab-1'));
      fireEvent.click(await screen.findByTestId('tab-delete-move'));

      expect(onDeleteTab).toHaveBeenCalledWith('tab-1', 'move');
    });

    it('does not call onDeleteTab when cancel is clicked', async () => {
      const onDeleteTab = jest.fn();
      renderDashboardContainer({ onDeleteTab, ...twoTabProps });

      const firstTab = screen.getByRole('tab', { name: 'First' });
      fireEvent.mouseEnter(firstTab);
      fireEvent.click(screen.getByTestId('tab-delete-tab-1'));
      fireEvent.click(await screen.findByTestId('tab-delete-cancel'));

      expect(onDeleteTab).not.toHaveBeenCalled();
    });
  });

  describe('group delete prompt', () => {
    const baseContainer = {
      id: 'g1',
      title: 'My Group',
      collapsed: false,
      tabs: [{ id: 'tab-1', title: 'My Group' }],
    };

    it('opens the delete modal when "Delete Group" menu item is clicked', async () => {
      renderDashboardContainer({
        onDelete: jest.fn(),
        tileCount: 2,
        container: baseContainer,
      });
      fireEvent.click(screen.getByTestId('group-menu-g1'));
      fireEvent.click(await screen.findByTestId('group-delete-g1'));
      expect(
        await screen.findByTestId('group-delete-modal'),
      ).toBeInTheDocument();
    });

    it('offers Ungroup + Delete when tileCount > 0', async () => {
      renderDashboardContainer({
        onDelete: jest.fn(),
        tileCount: 3,
        container: baseContainer,
      });
      fireEvent.click(screen.getByTestId('group-menu-g1'));
      fireEvent.click(await screen.findByTestId('group-delete-g1'));
      expect(
        await screen.findByTestId('group-delete-ungroup'),
      ).toBeInTheDocument();
      expect(screen.getByTestId('group-delete-confirm')).toBeInTheDocument();
      expect(screen.getByTestId('group-delete-cancel')).toBeInTheDocument();
    });

    it('hides Ungroup option when tileCount is 0', async () => {
      renderDashboardContainer({
        onDelete: jest.fn(),
        tileCount: 0,
        container: baseContainer,
      });
      fireEvent.click(screen.getByTestId('group-menu-g1'));
      fireEvent.click(await screen.findByTestId('group-delete-g1'));
      expect(
        screen.queryByTestId('group-delete-ungroup'),
      ).not.toBeInTheDocument();
      expect(
        await screen.findByTestId('group-delete-confirm'),
      ).toBeInTheDocument();
    });

    it('calls onDelete with "ungroup" when Ungroup Tiles is clicked', async () => {
      const onDelete = jest.fn();
      renderDashboardContainer({
        onDelete,
        tileCount: 2,
        container: baseContainer,
      });
      fireEvent.click(screen.getByTestId('group-menu-g1'));
      fireEvent.click(await screen.findByTestId('group-delete-g1'));
      fireEvent.click(await screen.findByTestId('group-delete-ungroup'));
      expect(onDelete).toHaveBeenCalledWith('ungroup');
    });

    it('calls onDelete with "delete" when Delete Group & Tiles is clicked', async () => {
      const onDelete = jest.fn();
      renderDashboardContainer({
        onDelete,
        tileCount: 2,
        container: baseContainer,
      });
      fireEvent.click(screen.getByTestId('group-menu-g1'));
      fireEvent.click(await screen.findByTestId('group-delete-g1'));
      fireEvent.click(await screen.findByTestId('group-delete-confirm'));
      expect(onDelete).toHaveBeenCalledWith('delete');
    });

    it('does not call onDelete when Cancel is clicked', async () => {
      const onDelete = jest.fn();
      renderDashboardContainer({
        onDelete,
        tileCount: 2,
        container: baseContainer,
      });
      fireEvent.click(screen.getByTestId('group-menu-g1'));
      fireEvent.click(await screen.findByTestId('group-delete-g1'));
      fireEvent.click(await screen.findByTestId('group-delete-cancel'));
      expect(onDelete).not.toHaveBeenCalled();
    });
  });

  describe('alert indicators', () => {
    it('shows alert dot on collapsed group header when alertingTabIds is non-empty', () => {
      const { container: wrapper } = renderDashboardContainer({
        collapsed: true,
        alertingTabIds: new Set(['tab-1']),
        container: {
          id: 'g1',
          title: 'Group',
          collapsed: false,
          tabs: [
            { id: 'tab-1', title: 'Overview' },
            { id: 'tab-2', title: 'Logs' },
          ],
        },
      });
      // Alert dot is rendered as a small span with red background
      const dots = wrapper.querySelectorAll(
        'span[style*="border-radius: 50%"]',
      );
      expect(dots.length).toBeGreaterThan(0);
    });

    it('does not show alert dot when alertingTabIds is empty', () => {
      const { container: wrapper } = renderDashboardContainer({
        collapsed: true,
        alertingTabIds: new Set(),
        container: {
          id: 'g1',
          title: 'Group',
          collapsed: false,
          tabs: [
            { id: 'tab-1', title: 'Overview' },
            { id: 'tab-2', title: 'Logs' },
          ],
        },
      });
      const dots = wrapper.querySelectorAll(
        'span[style*="border-radius: 50%"]',
      );
      expect(dots.length).toBe(0);
    });

    it('shows alert dot on expanded plain (single-tab) group header', () => {
      const { container: wrapper } = renderDashboardContainer({
        collapsed: false,
        alertingTabIds: new Set(['tab-1']),
        container: {
          id: 'g1',
          title: 'My Group',
          collapsed: false,
          tabs: [{ id: 'tab-1', title: 'Only' }],
        },
      });
      // No tab bar is rendered for single-tab groups — the indicator must
      // appear on the group header itself so alerts are visible at a glance
      // even when the alerting tile is below the fold.
      const dots = wrapper.querySelectorAll(
        'span[style*="border-radius: 50%"]',
      );
      expect(dots.length).toBeGreaterThan(0);
    });

    it('shows alert dot on specific tab in expanded tab bar', () => {
      renderDashboardContainer({
        collapsed: false,
        alertingTabIds: new Set(['tab-2']),
        container: {
          id: 'g1',
          title: 'Group',
          collapsed: false,
          tabs: [
            { id: 'tab-1', title: 'Overview' },
            { id: 'tab-2', title: 'Alerts' },
          ],
          activeTabId: 'tab-1',
        },
        activeTabId: 'tab-1',
        onTabChange: jest.fn(),
      });
      // The "Alerts" tab should have a dot, "Overview" should not
      const alertsTab = screen.getByRole('tab', { name: 'Alerts' });
      const overviewTab = screen.getByRole('tab', { name: 'Overview' });
      expect(
        alertsTab.querySelector('span[style*="border-radius: 50%"]'),
      ).toBeTruthy();
      expect(
        overviewTab.querySelector('span[style*="border-radius: 50%"]'),
      ).toBeNull();
    });
  });
});
