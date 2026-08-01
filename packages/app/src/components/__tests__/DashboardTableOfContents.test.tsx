import React from 'react';
import { DashboardContainer as DashboardContainerSchema } from '@hyperdx/common-utils/dist/types';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import DashboardTableOfContents, {
  TOC_CONTAINER_ANCHOR_ID,
} from '@/components/DashboardTableOfContents';

const makeContainer = (
  overrides: Partial<DashboardContainerSchema> & { id: string },
): DashboardContainerSchema => ({
  title: `Section ${overrides.id}`,
  collapsed: false,
  ...overrides,
});

const renderTOC = (
  containers: DashboardContainerSchema[],
  overrides: {
    isCollapsed?: (c: DashboardContainerSchema) => boolean;
    onToggleCollapse?: jest.Mock;
    onClose?: jest.Mock;
  } = {},
) => {
  const props = {
    containers,
    isCollapsed: overrides.isCollapsed ?? (c => c.collapsed === true),
    onToggleCollapse: overrides.onToggleCollapse ?? jest.fn(),
    onClose: overrides.onClose ?? jest.fn(),
  };
  return {
    ...renderWithMantine(<DashboardTableOfContents {...props} />),
    props,
  };
};

describe('DashboardTableOfContents', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('visibility', () => {
    it('renders nothing when there are no containers', () => {
      renderTOC([]);
      // Mantine injects style tags into the container, so we check for the
      // absence of TOC-specific markers rather than an empty container.
      expect(screen.queryByTestId('dashboard-toc')).not.toBeInTheDocument();
      expect(screen.queryByText('Sections')).not.toBeInTheDocument();
    });

    it('renders the rail with a heading when at least one container exists', () => {
      renderTOC([makeContainer({ id: 'a' })]);
      expect(screen.getByTestId('dashboard-toc')).toBeInTheDocument();
      expect(screen.getByText('Sections')).toBeInTheDocument();
    });
  });

  describe('row labels', () => {
    it('renders one row per container using the container title by default', () => {
      renderTOC([
        makeContainer({ id: 'a', title: 'Alpha' }),
        makeContainer({ id: 'b', title: 'Bravo' }),
        makeContainer({ id: 'c', title: 'Charlie' }),
      ]);

      expect(screen.getByTestId('dashboard-toc-item-a')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-toc-item-b')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-toc-item-c')).toBeInTheDocument();
      expect(screen.getByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('Bravo')).toBeInTheDocument();
      expect(screen.getByText('Charlie')).toBeInTheDocument();
    });

    it("prefers the first tab's title when the container has tabs", () => {
      renderTOC([
        makeContainer({
          id: 'a',
          title: 'Container Title',
          tabs: [
            { id: 't1', title: 'First Tab Title' },
            { id: 't2', title: 'Second Tab Title' },
          ],
        }),
      ]);

      expect(screen.getByText('First Tab Title')).toBeInTheDocument();
      expect(screen.queryByText('Container Title')).not.toBeInTheDocument();
    });
  });

  describe('close button', () => {
    it('calls onClose when the close button is clicked', async () => {
      const onClose = jest.fn();
      const user = userEvent.setup();
      renderTOC([makeContainer({ id: 'a' })], { onClose });

      await user.click(screen.getByTestId('dashboard-toc-close'));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('click-to-jump behavior', () => {
    let scrollIntoViewMock: jest.Mock;
    let rafSpy: jest.SpyInstance;

    beforeEach(() => {
      scrollIntoViewMock = jest.fn();
      // jsdom does not implement scrollIntoView; provide a global mock.
      Element.prototype.scrollIntoView = scrollIntoViewMock;
      // Run rAF callbacks synchronously so we can assert on the scroll call.
      rafSpy = jest
        .spyOn(window, 'requestAnimationFrame')
        .mockImplementation(cb => {
          cb(0);
          return 0 as unknown as number;
        });
    });

    afterEach(() => {
      rafSpy.mockRestore();
    });

    it('scrolls to the matching anchor element on click without toggling when section is expanded', async () => {
      const onToggleCollapse = jest.fn();
      const user = userEvent.setup();

      const anchor = document.createElement('div');
      anchor.id = TOC_CONTAINER_ANCHOR_ID('a');
      document.body.appendChild(anchor);

      renderTOC([makeContainer({ id: 'a', collapsed: false })], {
        onToggleCollapse,
      });

      await user.click(screen.getByTestId('dashboard-toc-item-a'));

      expect(onToggleCollapse).not.toHaveBeenCalled();
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'start',
      });

      anchor.remove();
    });

    it('expands a collapsed section before scrolling', async () => {
      const onToggleCollapse = jest.fn();
      const user = userEvent.setup();

      const anchor = document.createElement('div');
      anchor.id = TOC_CONTAINER_ANCHOR_ID('a');
      document.body.appendChild(anchor);

      renderTOC([makeContainer({ id: 'a', collapsed: true })], {
        onToggleCollapse,
      });

      await user.click(screen.getByTestId('dashboard-toc-item-a'));

      expect(onToggleCollapse).toHaveBeenCalledTimes(1);
      expect(onToggleCollapse).toHaveBeenCalledWith('a');
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      anchor.remove();
    });

    it('does not throw when no matching anchor exists in the DOM', async () => {
      const onToggleCollapse = jest.fn();
      const user = userEvent.setup();

      renderTOC([makeContainer({ id: 'orphan', collapsed: false })], {
        onToggleCollapse,
      });

      await user.click(screen.getByTestId('dashboard-toc-item-orphan'));

      expect(scrollIntoViewMock).not.toHaveBeenCalled();
      expect(onToggleCollapse).not.toHaveBeenCalled();
    });

    it('never calls onToggleCollapse for non-collapsible sections, even if isCollapsed returns true', async () => {
      const onToggleCollapse = jest.fn();
      const user = userEvent.setup();

      const anchor = document.createElement('div');
      anchor.id = TOC_CONTAINER_ANCHOR_ID('locked');
      document.body.appendChild(anchor);

      renderTOC(
        [makeContainer({ id: 'locked', collapsible: false, collapsed: true })],
        {
          onToggleCollapse,
          // Even if the caller's predicate reports collapsed, a non-collapsible
          // section must not be toggled — it can't collapse to begin with.
          isCollapsed: () => true,
        },
      );

      await user.click(screen.getByTestId('dashboard-toc-item-locked'));

      expect(onToggleCollapse).not.toHaveBeenCalled();
      expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);

      anchor.remove();
    });
  });

  describe('TOC_CONTAINER_ANCHOR_ID', () => {
    it('produces a stable, container-id-derived anchor id', () => {
      expect(TOC_CONTAINER_ANCHOR_ID('abc-123')).toBe(
        'dashboard-container-abc-123',
      );
    });
  });
});
