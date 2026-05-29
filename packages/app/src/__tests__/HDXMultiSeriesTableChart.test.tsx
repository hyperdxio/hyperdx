import React from 'react';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { Table } from '@/HDXMultiSeriesTableChart';

// Next.js Link needs a router context; the router isn't exercised
// because we never trigger client-side navigation in these tests.
jest.mock('next/router', () => ({
  useRouter: () => ({
    push: jest.fn(),
    prefetch: jest.fn(),
    pathname: '/',
    query: {},
  }),
}));

// JSDOM gives the table container 0×0 dimensions, so the real
// virtualizer renders no rows. Stub it to render every row as if
// visible. The hint / button / link assertions don't depend on
// virtualization correctness.
jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 58,
        end: (index + 1) * 58,
        size: 58,
      })),
    getTotalSize: () => count * 58,
    measureElement: () => {},
    options: { scrollMargin: 0 },
  }),
}));

const baseColumns = [
  {
    id: 'service',
    dataKey: 'ServiceName',
    displayName: 'Service',
  },
  {
    id: 'count',
    dataKey: 'Count',
    displayName: 'Count',
  },
];

const baseData = [{ ServiceName: 'web', Count: 10 }];

describe('HDXMultiSeriesTableChart <Table>', () => {
  describe('getRowAction success path', () => {
    it('renders the row click cell as a real <a href> with the resolved URL', () => {
      const getRowAction = jest.fn().mockReturnValue({
        url: '/search?source=src_1&where=',
        description: 'Search HyperDX Logs',
      });

      renderWithMantine(
        <Table
          data={baseData}
          columns={baseColumns}
          getRowAction={getRowAction}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const links = screen.getAllByTestId('dashboard-table-row-action');
      expect(links.length).toBeGreaterThan(0);
      links.forEach(link => {
        expect(link.tagName).toBe('A');
        expect(link.getAttribute('data-shape')).toBe('link');
        expect(link.getAttribute('href')).toContain('/search?source=src_1');
      });
    });

    it('reveals the hint at the cursor when hovering a success row', async () => {
      const getRowAction = jest.fn().mockReturnValue({
        url: '/search?source=src_1&where=',
        description: 'Search HyperDX Logs',
      });

      renderWithMantine(
        <Table
          data={baseData}
          columns={baseColumns}
          getRowAction={getRowAction}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const row = screen.getByText('web').closest('tr')!;
      fireEvent.mouseEnter(row);

      await waitFor(
        () => {
          expect(screen.getByText('Search HyperDX Logs')).toBeInTheDocument();
        },
        { timeout: 1000 },
      );
    });

    it('hides the hint after mouseLeave so tooltip cannot get stranded (HDX-4405)', async () => {
      // Regression test: the tooltip must disappear when the row is left.
      // Previously each virtual row mounted its own Tooltip.Floating; if the
      // row unmounted before onMouseLeave fired (rapid mouse movement), the
      // Portal-rendered tooltip stayed visible. The fix moves the single
      // Tooltip.Floating to <tbody> so its state never gets stranded.
      const getRowAction = jest.fn().mockReturnValue({
        url: '/search?source=src_1&where=',
        description: 'Search HyperDX Logs',
      });

      renderWithMantine(
        <Table
          data={baseData}
          columns={baseColumns}
          getRowAction={getRowAction}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const row = screen.getByText('web').closest('tr')!;

      // Show tooltip
      fireEvent.mouseEnter(row);
      await waitFor(() =>
        expect(screen.getByText('Search HyperDX Logs')).toBeInTheDocument(),
      );

      // Leave the row — tooltip must disappear
      fireEvent.mouseLeave(row);
      await waitFor(() =>
        expect(
          screen.queryByText('Search HyperDX Logs'),
        ).not.toBeInTheDocument(),
      );
    });
  });

  describe('getRowAction failure path', () => {
    it('renders the cell as a <button> when the row resolution failed and wires onClickError', () => {
      const onClickError = jest.fn();
      const getRowAction = jest.fn().mockReturnValue({
        url: null,
        description: 'Search HyperDX Logs',
        onClickError,
      });

      renderWithMantine(
        <Table
          data={baseData}
          columns={baseColumns}
          getRowAction={getRowAction}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const buttons = screen.getAllByTestId('dashboard-table-row-action');
      expect(buttons.length).toBeGreaterThan(0);
      buttons.forEach(btn => {
        expect(btn.tagName).toBe('BUTTON');
        expect(btn.getAttribute('data-shape')).toBe('button');
        // No href anywhere, so cmd-click / middle-click / right-click
        // "Open in New Tab" can't silently open the page.
        expect(btn.hasAttribute('href')).toBe(false);
      });

      fireEvent.click(buttons[0]);
      expect(onClickError).toHaveBeenCalledTimes(1);
    });

    it('does not reveal a hint when the row action has no url', async () => {
      const getRowAction = jest.fn().mockReturnValue({
        url: null,
        description: 'Search HyperDX Logs',
        onClickError: jest.fn(),
      });

      renderWithMantine(
        <Table
          data={baseData}
          columns={baseColumns}
          getRowAction={getRowAction}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const row = screen.getByText('web').closest('tr')!;
      fireEvent.mouseEnter(row);

      // Give the tooltip a chance to mount; assert it never does.
      await new Promise(resolve => setTimeout(resolve, 250));
      expect(screen.queryByText('Search HyperDX Logs')).not.toBeInTheDocument();
    });
  });

  describe('legacy getRowSearchLink fallback', () => {
    it('renders the cell as a Link without a HoverCard when only getRowSearchLink is provided', () => {
      const getRowSearchLink = jest
        .fn()
        .mockReturnValue('/search?source=legacy&where=');

      renderWithMantine(
        <Table
          data={baseData}
          columns={baseColumns}
          getRowSearchLink={getRowSearchLink}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const links = screen.getAllByTestId('dashboard-table-row-action');
      links.forEach(link => {
        expect(link.tagName).toBe('A');
        expect(link.getAttribute('data-shape')).toBe('link');
        expect(link.getAttribute('href')).toContain('/search?source=legacy');
      });
    });
  });

  describe('no action configured', () => {
    it('renders plain cells with no Link, button, or HoverCard', () => {
      renderWithMantine(
        <Table
          data={baseData}
          columns={baseColumns}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      expect(
        screen.queryAllByTestId('dashboard-table-row-action'),
      ).toHaveLength(0);
    });
  });
});
