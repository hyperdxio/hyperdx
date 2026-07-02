import React from 'react';
import type { ChartPaletteToken } from '@hyperdx/common-utils/dist/types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { Table } from '@/HDXMultiSeriesTableChart';
import { getColorFromCSSToken } from '@/utils';

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

    it('marks actionable rows with the actionableRow class so they hover to --color-bg-highlighted', () => {
      // Rows with a resolved click destination get a stronger hover
      // background than non-actionable rows. The differentiation is
      // applied via the `actionableRow` CSS module class on the <tr>;
      // non-actionable rows fall through to the global
      // `bg-muted-hover` utility (a lighter muted hover).
      const getRowAction = jest.fn().mockReturnValue({
        url: '/search?source=src_1&where=',
        description: 'Search HyperDX Logs',
      });

      const { container } = renderWithMantine(
        <Table
          data={baseData}
          columns={baseColumns}
          getRowAction={getRowAction}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const rows = container.querySelectorAll('tbody tr[data-index]');
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach(row => {
        expect(row.className).toContain('actionableRow');
        expect(row.className).not.toContain('bg-muted-hover');
      });
    });

    it('renders a trailing arrow hint in the last cell of a success row', () => {
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

      const hint = screen.getByTestId('row-action-hint');
      expect(hint.tagName).toBe('A');
      expect(hint.getAttribute('href')).toContain('/search?source=src_1');
      expect(hint.getAttribute('aria-hidden')).toBe('true');
    });

    it('shows the description in an anchored tooltip when the arrow is hovered', async () => {
      const user = userEvent.setup();
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

      const hint = screen.getByTestId('row-action-hint');
      await user.hover(hint);

      // Mantine renders the Tooltip label as an element with role="tooltip"
      // (with the label text as its accessible name) once opened.
      await waitFor(
        () => {
          expect(
            screen.getByRole('tooltip', { name: 'Search HyperDX Logs' }),
          ).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });

    it('renders the dashboard variant description in the tooltip', async () => {
      const user = userEvent.setup();
      const getRowAction = jest.fn().mockReturnValue({
        url: '/dashboards/dash_1?where=',
        description: 'Open dashboard "API Latency"',
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

      const hint = screen.getByTestId('row-action-hint');
      await user.hover(hint);

      await waitFor(
        () => {
          expect(
            screen.getByRole('tooltip', {
              name: 'Open dashboard "API Latency"',
            }),
          ).toBeInTheDocument();
        },
        { timeout: 2000 },
      );
    });
  });

  describe('external link path', () => {
    it('renders the cell as a plain <a target="_blank"> for external actions', () => {
      const getRowAction = jest.fn().mockReturnValue({
        url: 'https://grafana.example.com/d/abc?svc=web',
        description: 'https://grafana.example.com/d/abc?svc=web',
        external: true,
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
        expect(link.getAttribute('data-shape')).toBe('external-link');
        expect(link.getAttribute('href')).toBe(
          'https://grafana.example.com/d/abc?svc=web',
        );
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
      });
    });

    it('renders the trailing arrow hint as an external anchor opening in a new tab', () => {
      const getRowAction = jest.fn().mockReturnValue({
        url: 'https://grafana.example.com/d/abc?svc=web',
        description: 'https://grafana.example.com/d/abc?svc=web',
        external: true,
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

      const hint = screen.getByTestId('row-action-hint');
      expect(hint.tagName).toBe('A');
      expect(hint.getAttribute('target')).toBe('_blank');
      expect(hint.getAttribute('rel')).toBe('noopener noreferrer');
      expect(hint.getAttribute('href')).toBe(
        'https://grafana.example.com/d/abc?svc=web',
      );
    });
  });

  describe('getRowAction failure path', () => {
    it('renders the cell as a <button> when the row resolution failed and wires onClickError', async () => {
      const user = userEvent.setup();
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

      await user.click(buttons[0]);
      expect(onClickError).toHaveBeenCalledTimes(1);
    });

    it('leaves non-actionable rows on bg-muted-hover (no actionableRow class)', () => {
      // Mirror of the success-path actionableRow test: rows whose
      // action returns `url: null` keep the default muted hover
      // utility and never gain the stronger `actionableRow` class.
      const getRowAction = jest.fn().mockReturnValue({
        url: null,
        description: 'Search HyperDX Logs',
        onClickError: jest.fn(),
      });

      const { container } = renderWithMantine(
        <Table
          data={baseData}
          columns={baseColumns}
          getRowAction={getRowAction}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const rows = container.querySelectorAll('tbody tr[data-index]');
      expect(rows.length).toBeGreaterThan(0);
      rows.forEach(row => {
        expect(row.className).not.toContain('actionableRow');
        expect(row.className).toContain('bg-muted-hover');
      });
    });

    it('does not render a trailing arrow hint when rowAction.url is null', () => {
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

      // The icon must not be in the DOM at all on failure rows: showing
      // an arrow would promise a destination the click can't deliver,
      // because the click only fires an error toast.
      expect(screen.queryByTestId('row-action-hint')).toBeNull();
    });
  });

  describe('legacy getRowSearchLink fallback', () => {
    it('renders the cell as a Link without a trailing arrow hint when only getRowSearchLink is provided', () => {
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

      // No trailing arrow on the legacy path; it's an additive surface
      // tied to the new getRowAction prop only.
      expect(screen.queryByTestId('row-action-hint')).toBeNull();
    });
  });

  describe('no action configured', () => {
    it('renders plain cells with no Link, button, or trailing arrow', () => {
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
      expect(screen.queryByTestId('row-action-hint')).toBeNull();
    });
  });

  describe('per-column cell color', () => {
    const serviceCol = {
      id: 'service',
      dataKey: 'ServiceName',
      displayName: 'Service',
    };
    const colorData = [
      { ServiceName: 'web', Count: 600 },
      { ServiceName: 'api', Count: 10 },
    ];

    // Normalize an expected token through the same CSSOM the rendered cell
    // uses, so the assertion is exact without depending on hex-vs-rgb
    // serialization details.
    const normalizedColor = (token: ChartPaletteToken) => {
      const probe = document.createElement('span');
      probe.style.color = getColorFromCSSToken(token);
      return probe.style.color;
    };

    it('applies a static palette-token color to every cell in the column', () => {
      renderWithMantine(
        <Table
          data={colorData}
          columns={[
            serviceCol,
            {
              id: 'count',
              dataKey: 'Count',
              displayName: 'Count',
              color: 'chart-blue',
            },
          ]}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      const expected = normalizedColor('chart-blue');
      expect(expected).not.toBe('');
      expect((screen.getByText('600') as HTMLElement).style.color).toBe(
        expected,
      );
      expect((screen.getByText('10') as HTMLElement).style.color).toBe(
        expected,
      );
      // The uncolored group-by-style column stays default.
      expect((screen.getByText('web') as HTMLElement).style.color).toBe('');
    });

    it('applies a conditional rule only to cells whose value matches', () => {
      renderWithMantine(
        <Table
          data={colorData}
          columns={[
            serviceCol,
            {
              id: 'count',
              dataKey: 'Count',
              displayName: 'Count',
              colorRules: [
                { operator: 'gt', value: 100, color: 'chart-error' },
              ],
            },
          ]}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      // 600 > 100 matches the rule; 10 does not, so it falls back to the
      // default color (no static color set).
      expect((screen.getByText('600') as HTMLElement).style.color).not.toBe('');
      expect((screen.getByText('10') as HTMLElement).style.color).toBe('');
    });

    it('matches numeric rules against string-serialized values (ClickHouse counts)', () => {
      // ClickHouse serializes count() (UInt64) and other numeric aggregates as
      // strings, so the cell value arrives as "600" / "10", not 600 / 10. The
      // numeric `gt` rule must still match after coercion.
      renderWithMantine(
        <Table
          data={[
            { ServiceName: 'web', Count: '600' },
            { ServiceName: 'api', Count: '10' },
          ]}
          columns={[
            serviceCol,
            {
              id: 'count',
              dataKey: 'Count',
              displayName: 'Count',
              colorRules: [
                { operator: 'gt', value: 100, color: 'chart-error' },
              ],
            },
          ]}
          sorting={[]}
          onSortingChange={() => {}}
        />,
      );

      expect((screen.getByText('600') as HTMLElement).style.color).not.toBe('');
      expect((screen.getByText('10') as HTMLElement).style.color).toBe('');
    });

    it('renders the default color for an unknown token without throwing', () => {
      expect(() =>
        renderWithMantine(
          <Table
            data={[{ ServiceName: 'web', Count: 10 }]}
            columns={[
              serviceCol,
              {
                id: 'count',
                dataKey: 'Count',
                displayName: 'Count',
                // Simulates a legacy / hand-edited token absent from the
                // current palette; the renderer must not crash.
                color: 'chart-1' as unknown as ChartPaletteToken,
              },
            ]}
            sorting={[]}
            onSortingChange={() => {}}
          />,
        ),
      ).not.toThrow();
      expect((screen.getByText('10') as HTMLElement).style.color).toBe('');
    });
  });
});
