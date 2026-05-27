import * as React from 'react';
import { DashboardContainer as DashboardContainerSchema } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';

import DashboardTableOfContents, {
  dashboardSectionAnchorId,
} from '@/components/DashboardTableOfContents';

function makeContainer(
  overrides: Partial<DashboardContainerSchema> & {
    id: string;
    title: string;
  },
): DashboardContainerSchema {
  return {
    collapsed: false,
    tabs: [{ id: `${overrides.id}-tab-1`, title: overrides.title }],
    ...overrides,
  } as DashboardContainerSchema;
}

type RenderProps = Partial<
  React.ComponentProps<typeof DashboardTableOfContents>
>;

function renderTOC(props: RenderProps = {}) {
  const defaults: React.ComponentProps<typeof DashboardTableOfContents> = {
    containers: [
      makeContainer({ id: 'a', title: 'Alpha' }),
      makeContainer({ id: 'b', title: 'Beta', collapsed: true }),
    ],
    isContainerCollapsed: c => Boolean(c.collapsed),
    onNavigate: jest.fn(),
    onExpandAll: jest.fn(),
    onCollapseAll: jest.fn(),
    onClose: jest.fn(),
    ...props,
  };
  return {
    ...render(
      <MantineProvider>
        <DashboardTableOfContents {...defaults} />
      </MantineProvider>,
    ),
    props: defaults,
  };
}

describe('DashboardTableOfContents', () => {
  describe('rendering', () => {
    it('renders nothing when there are no containers', () => {
      renderTOC({ containers: [] });
      expect(screen.queryByTestId('dashboard-toc')).not.toBeInTheDocument();
    });

    it('lists one entry per container, labelled by the first tab title', () => {
      renderTOC({
        containers: [
          makeContainer({
            id: 'a',
            title: 'Container Title',
            tabs: [
              { id: 't1', title: 'First Tab' },
              { id: 't2', title: 'Second Tab' },
            ],
          }),
        ],
      });
      expect(screen.getByTestId('dashboard-toc-item-a')).toHaveTextContent(
        'First Tab',
      );
    });

    it('falls back to container.title when no tabs are present', () => {
      renderTOC({
        containers: [
          makeContainer({ id: 'a', title: 'Legacy Group', tabs: undefined }),
        ],
      });
      expect(screen.getByTestId('dashboard-toc-item-a')).toHaveTextContent(
        'Legacy Group',
      );
    });

    it('shows the section count next to the header', () => {
      renderTOC();
      expect(screen.getByTestId('dashboard-toc')).toHaveTextContent('(2)');
    });
  });

  describe('navigation', () => {
    it('calls onNavigate with the container id when an entry is clicked', () => {
      const onNavigate = jest.fn();
      renderTOC({ onNavigate });
      fireEvent.click(screen.getByTestId('dashboard-toc-item-b'));
      expect(onNavigate).toHaveBeenCalledWith('b');
    });
  });

  describe('close button', () => {
    it('calls onClose when the close button is clicked', () => {
      const onClose = jest.fn();
      renderTOC({ onClose });
      fireEvent.click(screen.getByTestId('dashboard-toc-close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('expand/collapse all controls', () => {
    it('renders expand/collapse all when any section is collapsible', () => {
      renderTOC();
      expect(
        screen.getByTestId('dashboard-toc-expand-all'),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId('dashboard-toc-collapse-all'),
      ).toBeInTheDocument();
    });

    it('hides bulk controls when no section is collapsible', () => {
      renderTOC({
        containers: [
          makeContainer({ id: 'a', title: 'Alpha', collapsible: false }),
        ],
      });
      expect(
        screen.queryByTestId('dashboard-toc-expand-all'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId('dashboard-toc-collapse-all'),
      ).not.toBeInTheDocument();
    });

    it('disables "Expand all" when all collapsible sections are already expanded', () => {
      renderTOC({
        containers: [
          makeContainer({ id: 'a', title: 'Alpha' }),
          makeContainer({ id: 'b', title: 'Beta' }),
        ],
        isContainerCollapsed: () => false,
      });
      expect(screen.getByTestId('dashboard-toc-expand-all')).toBeDisabled();
      expect(screen.getByTestId('dashboard-toc-collapse-all')).toBeEnabled();
    });

    it('disables "Collapse all" when all collapsible sections are already collapsed', () => {
      renderTOC({
        containers: [
          makeContainer({ id: 'a', title: 'Alpha', collapsed: true }),
          makeContainer({ id: 'b', title: 'Beta', collapsed: true }),
        ],
        isContainerCollapsed: c => Boolean(c.collapsed),
      });
      expect(screen.getByTestId('dashboard-toc-collapse-all')).toBeDisabled();
      expect(screen.getByTestId('dashboard-toc-expand-all')).toBeEnabled();
    });

    it('calls onExpandAll/onCollapseAll when the buttons are clicked', () => {
      const onExpandAll = jest.fn();
      const onCollapseAll = jest.fn();
      renderTOC({ onExpandAll, onCollapseAll });
      fireEvent.click(screen.getByTestId('dashboard-toc-expand-all'));
      fireEvent.click(screen.getByTestId('dashboard-toc-collapse-all'));
      expect(onExpandAll).toHaveBeenCalledTimes(1);
      expect(onCollapseAll).toHaveBeenCalledTimes(1);
    });

    it('ignores non-collapsible sections for the enable/disable logic', () => {
      // Both sections are collapsible:false, so "Expand all" / "Collapse all"
      // should never appear in the first place.
      renderTOC({
        containers: [
          makeContainer({
            id: 'a',
            title: 'Alpha',
            collapsible: false,
            collapsed: true,
          }),
        ],
        isContainerCollapsed: c => Boolean(c.collapsed),
      });
      expect(
        screen.queryByTestId('dashboard-toc-expand-all'),
      ).not.toBeInTheDocument();
    });
  });

  describe('anchor id helper', () => {
    it('produces a stable id per container', () => {
      expect(dashboardSectionAnchorId('foo')).toBe('dashboard-section-foo');
    });
  });
});
