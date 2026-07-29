// The `use*` keys below are jest.mock factory entries standing in for hooks, not
// hooks themselves, so the "doesn't call any Hooks" rule doesn't apply — the name
// has to match the real export for the mock to resolve.
/* eslint-disable @eslint-react/no-unnecessary-use-prefix */
import React from 'react';
import { Exemplar } from '@hyperdx/common-utils/dist/types';
import { act } from '@testing-library/react';

import { DBTimeChart } from '@/components/DBTimeChart';
import type { ExemplarHoverCard } from '@/components/Exemplars';
import type { MemoChart } from '@/HDXMultiSeriesTimeChart';

type ChartProps = React.ComponentProps<typeof MemoChart>;
type CardProps = React.ComponentProps<typeof ExemplarHoverCard>;

// Same stubbing strategy as DBTimeChartExemplarPin: the wiring under test lives
// in DBTimeChart, so the chart and card are stubbed and driven through the
// callbacks they're handed. `mock`-prefixed so jest's hoisted factories may close
// over them.
const mockChart = jest.fn((_props: ChartProps) => null);
const mockCard = jest.fn((_props: CardProps) => null);
const mockUseMe = jest.fn();
const mockUseSource = jest.fn();
const mockUseQueriedChartConfig = jest.fn();
const mockUseExemplars = jest.fn();
const mockUseExemplarTraceMeta = jest.fn();
const mockRouterPush = jest.fn();

jest.mock('@/HDXMultiSeriesTimeChart', () => ({
  __esModule: true,
  MemoChart: (props: ChartProps) => mockChart(props),
}));

jest.mock('@/components/Exemplars', () => ({
  __esModule: true,
  ExemplarHoverCard: (props: CardProps) => mockCard(props),
}));

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: (...args: unknown[]) =>
    mockUseQueriedChartConfig(...args),
}));

jest.mock('@/hooks/useMVOptimizationExplanation', () => ({
  useMVOptimizationExplanation: jest
    .fn()
    .mockReturnValue({ data: undefined, isLoading: false }),
}));

jest.mock('@/api', () => ({
  __esModule: true,
  default: { useMe: (...args: unknown[]) => mockUseMe(...args) },
}));

jest.mock('@/source', () => ({
  useSource: (...args: unknown[]) => mockUseSource(...args),
  useChartNumberFormats: jest
    .fn()
    .mockReturnValue({ formatByColumn: new Map(), chartFormat: undefined }),
}));

jest.mock('@/hooks/useExemplars', () => ({
  useExemplars: (...args: unknown[]) => mockUseExemplars(...args),
  useExemplarTraceMeta: (...args: unknown[]) =>
    mockUseExemplarTraceMeta(...args),
}));

jest.mock('next/router', () => ({
  __esModule: true,
  default: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

jest.mock('@/components/MaterializedViews/MVOptimizationIndicator', () =>
  jest.fn(() => null),
);
jest.mock('@/components/charts/DateRangeIndicator', () => jest.fn(() => null));

const exemplar: Exemplar = {
  timestamp: 1704067200000,
  value: 42,
  traceId: 'abc123',
};

function lastProps<P>(calls: [P][], what: string): P {
  if (calls.length === 0) throw new Error(`${what} was never rendered`);
  return calls[calls.length - 1][0];
}
const cardProps = () => lastProps(mockCard.mock.calls, 'ExemplarHoverCard');

describe('DBTimeChart exemplar trace wiring', () => {
  const baseConfig = {
    dateRange: [new Date('2024-01-01'), new Date('2024-01-02')] as [Date, Date],
    from: { databaseName: 'test', tableName: 'test' },
    timestampValueExpression: 'timestamp',
    connection: 'test-connection',
    select: 'value',
    where: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMe.mockReturnValue({
      data: { team: { parallelizeWhenPossible: false } },
      isLoading: false,
    });
    mockUseSource.mockReturnValue({ data: undefined, isLoading: false });
    mockUseExemplars.mockReturnValue({
      exemplars: [exemplar],
      isLoading: false,
      isError: false,
      dropped: undefined,
    });
    mockUseExemplarTraceMeta.mockReturnValue({ data: null, isLoading: false });
    mockUseQueriedChartConfig.mockReturnValue({
      data: {
        data: [{ timestamp: '2024-01-01 00:00:00', value: 100 }],
        meta: [
          { name: 'timestamp', type: 'DateTime' },
          { name: 'value', type: 'Float64' },
        ],
        rows: 1,
        isComplete: true,
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      isPlaceholderData: false,
    });
  });

  describe('trace source resolution', () => {
    it("prefers the chart's explicit exemplarTraceSourceId over the source's linked one", () => {
      mockUseSource.mockImplementation(({ id }: { id?: string }) =>
        id === 'metric-source'
          ? { data: { id: 'metric-source', traceSourceId: 'linked-traces' } }
          : { data: { id, kind: 'trace' } },
      );

      renderWithMantine(
        <DBTimeChart
          config={{ ...baseConfig, exemplarTraceSourceId: 'explicit-traces' }}
          sourceId="metric-source"
        />,
      );

      // Resolution feeds both the hover card's meta query and the deep link, so
      // asserting the id the source hook was asked for pins the precedence.
      expect(mockUseSource).toHaveBeenCalledWith({ id: 'explicit-traces' });
      expect(mockUseSource).not.toHaveBeenCalledWith({ id: 'linked-traces' });
    });

    it("falls back to the chart source's linked trace source", () => {
      mockUseSource.mockImplementation(({ id }: { id?: string }) =>
        id === 'metric-source'
          ? { data: { id: 'metric-source', traceSourceId: 'linked-traces' } }
          : { data: { id, kind: 'trace' } },
      );

      renderWithMantine(
        <DBTimeChart config={baseConfig} sourceId="metric-source" />,
      );

      expect(mockUseSource).toHaveBeenCalledWith({ id: 'linked-traces' });
    });

    it('reports an unconfigured trace source to the hover card', () => {
      // The card uses this to explain why "Inspect trace" is unavailable rather
      // than rendering a dead button.
      renderWithMantine(<DBTimeChart config={baseConfig} />);
      expect(cardProps().traceSourceConfigured).toBe(false);
    });
  });

  describe('deep links', () => {
    it('routes to the trace source in search when one is configured', () => {
      mockUseSource.mockReturnValue({
        data: { id: 'explicit-traces', kind: 'trace' },
        isLoading: false,
      });

      renderWithMantine(
        <DBTimeChart
          config={{ ...baseConfig, exemplarTraceSourceId: 'explicit-traces' }}
        />,
      );

      act(() => {
        cardProps().onInspect?.(exemplar);
      });

      expect(mockRouterPush).toHaveBeenCalledWith(
        '/search?source=explicit-traces&traceId=abc123',
      );
    });

    it('falls back to the standalone trace page without a trace source', () => {
      renderWithMantine(<DBTimeChart config={baseConfig} />);

      act(() => {
        cardProps().onInspect?.(exemplar);
      });

      expect(mockRouterPush).toHaveBeenCalledWith('/trace/abc123');
    });

    it('encodes a trace id that is not URL-safe', () => {
      renderWithMantine(<DBTimeChart config={baseConfig} />);

      act(() => {
        cardProps().onInspect?.({ ...exemplar, traceId: 'a/b?c' });
      });

      expect(mockRouterPush).toHaveBeenCalledWith('/trace/a%2Fb%3Fc');
    });
  });

  describe('non-fatal exemplar status', () => {
    // A failed scan and a suppressed overlay both used to render identically to
    // "no exemplars in this range", leaving no way to tell them apart.
    it('surfaces a failed exemplar query without replacing the chart', () => {
      mockUseExemplars.mockReturnValue({
        exemplars: [],
        isLoading: false,
        isError: true,
        dropped: undefined,
      });

      const { getByTestId, queryByText } = renderWithMantine(
        <DBTimeChart config={baseConfig} />,
      );

      expect(getByTestId('exemplar-notice')).toBeInTheDocument();
      // Non-fatal: the chart itself still renders.
      expect(queryByText(/No data found within time range/)).toBeNull();
      expect(mockChart).toHaveBeenCalled();
    });

    it('surfaces a suppressed multi-series overlay', () => {
      mockUseExemplars.mockReturnValue({
        exemplars: [],
        isLoading: false,
        isError: false,
        dropped: 'multiple-series',
      });

      const { getByTestId } = renderWithMantine(
        <DBTimeChart config={baseConfig} />,
      );

      expect(getByTestId('exemplar-notice')).toBeInTheDocument();
    });

    it('shows no notice when the overlay is simply empty', () => {
      mockUseExemplars.mockReturnValue({
        exemplars: [],
        isLoading: false,
        isError: false,
        dropped: undefined,
      });

      const { queryByTestId } = renderWithMantine(
        <DBTimeChart config={baseConfig} />,
      );

      expect(queryByTestId('exemplar-notice')).toBeNull();
    });
  });
});
