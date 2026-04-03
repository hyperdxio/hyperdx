import * as React from 'react';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import GroupContainer from '@/components/GroupContainer';

function renderGroupContainer(
  props: Partial<React.ComponentProps<typeof GroupContainer>> = {},
) {
  const defaults: React.ComponentProps<typeof GroupContainer> = {
    container: {
      id: 'g1',
      type: 'group',
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
      <GroupContainer {...defaults} />
    </MantineProvider>,
  );
}

describe('GroupContainer', () => {
  describe('collapsible behavior', () => {
    it('renders chevron when collapsible (default)', () => {
      renderGroupContainer();
      expect(screen.getByTestId('group-chevron-g1')).toBeInTheDocument();
    });

    it('hides chevron when collapsible is false', () => {
      renderGroupContainer({
        container: {
          id: 'g1',
          type: 'group',
          title: 'Test',
          collapsed: false,
          collapsible: false,
          tabs: [{ id: 'tab-1', title: 'Tab One' }],
        },
      });
      expect(screen.queryByTestId('group-chevron-g1')).not.toBeInTheDocument();
    });

    it('shows children when expanded', () => {
      renderGroupContainer({ collapsed: false });
      expect(screen.getByTestId('group-children')).toBeInTheDocument();
    });

    it('hides children when collapsed', () => {
      renderGroupContainer({ collapsed: true });
      expect(screen.queryByTestId('group-children')).not.toBeInTheDocument();
    });

    it('calls onToggle when chevron is clicked', () => {
      const onToggle = jest.fn();
      renderGroupContainer({ onToggle });
      fireEvent.click(screen.getByTestId('group-chevron-g1'));
      expect(onToggle).toHaveBeenCalledTimes(1);
    });
  });

  describe('bordered behavior', () => {
    it('renders border by default', () => {
      renderGroupContainer();
      const container = screen.getByTestId('group-container-g1');
      expect(container.style.border).toContain('1px solid');
    });

    it('hides border when bordered is false', () => {
      renderGroupContainer({
        container: {
          id: 'g1',
          type: 'group',
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
      renderGroupContainer({
        collapsed: true,
        container: {
          id: 'g1',
          type: 'group',
          title: 'My Group',
          collapsed: false,
          tabs: [
            { id: 'tab-1', title: 'Overview' },
            { id: 'tab-2', title: 'Details' },
            { id: 'tab-3', title: 'Logs' },
          ],
        },
      });
      expect(screen.getByText('Overview · Details · Logs')).toBeInTheDocument();
    });

    it('does not show tab summary when expanded', () => {
      renderGroupContainer({
        collapsed: false,
        container: {
          id: 'g1',
          type: 'group',
          title: 'My Group',
          collapsed: false,
          tabs: [
            { id: 'tab-1', title: 'Overview' },
            { id: 'tab-2', title: 'Details' },
          ],
        },
      });
      expect(screen.queryByText('Overview · Details')).not.toBeInTheDocument();
    });

    it('does not show dot-separated tab summary for single-tab group', () => {
      renderGroupContainer({
        collapsed: true,
        container: {
          id: 'g1',
          type: 'group',
          title: 'My Group',
          collapsed: false,
          tabs: [{ id: 'tab-1', title: 'Only Tab' }],
        },
      });
      // Header title shows "Only Tab" but there's no dot-separated summary
      expect(screen.queryByText(/·/)).not.toBeInTheDocument();
    });
  });

  describe('overflow menu conditional rendering', () => {
    // Mantine Menu renders dropdown items in a portal only when opened,
    // so we test the negative case (items that should NOT be in the DOM).
    it('hides default-collapsed toggle when collapsible is false', () => {
      renderGroupContainer({
        onToggleDefaultCollapsed: jest.fn(),
        container: {
          id: 'g1',
          type: 'group',
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
      renderGroupContainer({
        container: {
          id: 'g1',
          type: 'group',
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
      renderGroupContainer({
        container: {
          id: 'g1',
          type: 'group',
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
    it('calls onDeleteTab with confirmation when confirm is provided', async () => {
      const onDeleteTab = jest.fn();
      const confirm = jest.fn().mockResolvedValue(true);
      renderGroupContainer({
        onDeleteTab,
        confirm,
        container: {
          id: 'g1',
          type: 'group',
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

      // Hover over first tab to reveal delete button
      const firstTab = screen.getByRole('tab', { name: 'First' });
      fireEvent.mouseEnter(firstTab);
      const deleteBtn = screen.getByTestId('tab-delete-tab-1');
      fireEvent.click(deleteBtn);

      // Wait for async confirm
      await screen.findByText('First');
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onDeleteTab).toHaveBeenCalledWith('tab-1');
    });

    it('does not call onDeleteTab when confirm is rejected', async () => {
      const onDeleteTab = jest.fn();
      const confirm = jest.fn().mockResolvedValue(false);
      renderGroupContainer({
        onDeleteTab,
        confirm,
        container: {
          id: 'g1',
          type: 'group',
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

      const firstTab = screen.getByRole('tab', { name: 'First' });
      fireEvent.mouseEnter(firstTab);
      const deleteBtn = screen.getByTestId('tab-delete-tab-1');
      fireEvent.click(deleteBtn);

      // Wait a tick for the async confirm to settle
      await new Promise(r => setTimeout(r, 0));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(onDeleteTab).not.toHaveBeenCalled();
    });
  });
});
