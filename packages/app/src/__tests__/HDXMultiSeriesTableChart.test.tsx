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

    it('hides the hint when the hovered virtual index maps to a no-URL row (HDX-4405)', async () => {
      // Regression for the virtualiser race: the hovered <tr> can unmount
      // before its onMouseLeave fires (rapid movement / data refresh). The
      // old per-row Tooltip.Floating was stranded in the Portal; the fix
      // stores a virtual index and re-derives the label via useMemo each
      // render. When the row at that index no longer has a URL, the tooltip
      // hides without a leave event from the (now-gone) element.
      //
      // We verify the key invariant structurally: hovering index 0 (URL row)
      // shows the hint; hovering index 1 (no-URL row) hides it — no
      // mouseLeave fires between the two enterevents, simulating the
      // cursor jumping over the table faster than leave events dispatch.
      const multiRowData = [
        { ServiceName: 'web', Count: 10 },
        { ServiceName: 'api', Count: 5 },
      ];
      const getRowAction = jest.fn((row: { ServiceName: string }) =>
        row.ServiceName === 'web'
          ? { url: '/search?source=src_1&where=', description: 'Search Logs' }
          : { url: null, description: '', onClickError: jest.fn() },
      );

      renderWithMantine(
        <Table
          data={multiRowData}
          columns={baseColumns}
          getRowAction={getRowAction}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const webRow = screen.getByText('web').closest('tr')!;
      const apiRow = screen.getByText('api').closest('tr')!;

      // Hover the URL row — tooltip must appear
      fireEvent.mouseEnter(webRow);
      await waitFor(() => {
        const hint = screen.getByTestId('row-action-hint');
        const tooltipBox = hint.closest<HTMLElement>('[style*="display"]');
        expect(tooltipBox?.style.display).toBe('block');
      });

      // Hover the no-URL row WITHOUT firing mouseLeave on the first row.
      // This simulates the cursor jumping faster than leave events dispatch.
      fireEvent.mouseEnter(apiRow);

      // The label must derive to null (apiRow has url:null) so tooltip hides.
      await waitFor(() => {
        const hint = screen.getByTestId('row-action-hint');
        const tooltipBox = hint.closest<HTMLElement>('[style*="display"]');
        expect(tooltipBox?.style.display).toBe('none');
      });
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
