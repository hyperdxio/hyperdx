import React from 'react';
import { Exemplar } from '@hyperdx/common-utils/dist/types';
import { act } from '@testing-library/react';

import { DBTimeChart } from '@/components/DBTimeChart';
import type { ExemplarHoverCard } from '@/components/Exemplars';
import type { MemoChart } from '@/HDXMultiSeriesTimeChart';

type ChartProps = React.ComponentProps<typeof MemoChart>;
type CardProps = React.ComponentProps<typeof ExemplarHoverCard>;

// `mock`-prefixed so jest's hoisted factories may close over them. Holding the
// mocks here (rather than asserting the imported symbols to jest.Mock) keeps the
// file free of type assertions, and typing the props means the test breaks if
// the chart's exemplar contract changes.
const mockChart = jest.fn((_props: ChartProps) => null);
const mockCard = jest.fn((_props: CardProps) => null);
const mockUseMe = jest.fn();
const mockUseSource = jest.fn();
const mockUseQueriedChartConfig = jest.fn();

// The pin lifecycle lives in DBTimeChart's state, driven by callbacks the chart
// hands down. Stub the chart and the card so the state machine can be driven
// directly — rendering recharts in jsdom would test the marker, not the wiring.
// Each factory runs while the consts above are still in their temporal dead
// zone, so the reference has to be deferred into the call itself.
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

const exemplar: Exemplar = {
  timestamp: 1704067200000,
  value: 42,
  traceId: 'abc123',
};

jest.mock('@/hooks/useExemplars', () => ({
  useExemplars: jest.fn().mockReturnValue({
    exemplars: [
      { timestamp: 1704067200000, value: 42, traceId: 'abc123' },
    ] as Exemplar[],
    isLoading: false,
    isError: false,
  }),
  useExemplarTraceMeta: jest
    .fn()
    .mockReturnValue({ data: null, isLoading: false }),
}));

jest.mock('../MaterializedViews/MVOptimizationIndicator', () =>
  jest.fn(() => null),
);
jest.mock('../charts/DateRangeIndicator', () => jest.fn(() => null));

/** Latest props the stubbed chart / card were rendered with. */
function lastProps<P>(calls: [P][], what: string): P {
  if (calls.length === 0) throw new Error(`${what} was never rendered`);
  return calls[calls.length - 1][0];
}
const chartProps = () => lastProps(mockChart.mock.calls, 'MemoChart');
const cardProps = () => lastProps(mockCard.mock.calls, 'ExemplarHoverCard');

/** Narrow an optional callback prop the chart is expected to have been given. */
function callback<A extends unknown[]>(
  fn: ((...args: A) => void) | undefined,
  name: string,
): (...args: A) => void {
  if (!fn) throw new Error(`${name} was not passed to the chart`);
  return fn;
}

describe('DBTimeChart exemplar pin lifecycle', () => {
  const config = {
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
    mockUseSource.mockReturnValue({
      data: undefined,
      isLoading: false,
    });
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

  const pin = () =>
    act(() => {
      callback(chartProps().onExemplarSelect, 'onExemplarSelect')(
        exemplar,
        10,
        20,
      );
    });

  it('pins the card on marker click and reports the pinned key to the chart', () => {
    renderWithMantine(<DBTimeChart config={config} />);
    expect(cardProps().pinned).toBe(false);

    pin();

    expect(cardProps().pinned).toBe(true);
    expect(cardProps().hovered).toEqual({ exemplar, x: 10, y: 20 });
    // The key, not a boolean — it's what lets the chart notice the marker going
    // away. It must match the key the chart builds for the same exemplar.
    expect(chartProps().pinnedExemplarKey).toBe(
      `exemplar-${exemplar.traceId}-${exemplar.timestamp}`,
    );
  });

  it('closes the pinned card when its marker leaves the rendered set', () => {
    // The regression this guards: a refetch or brush-zoom drops the marker, the
    // card floats at stale coordinates, and because a pin suppresses the series
    // tooltip the whole chart loses hover until the close button is found.
    renderWithMantine(<DBTimeChart config={config} />);
    pin();
    expect(cardProps().pinned).toBe(true);

    act(() => {
      callback(chartProps().onExemplarPinEnd, 'onExemplarPinEnd')();
    });

    expect(cardProps().pinned).toBe(false);
    expect(chartProps().pinnedExemplarKey).toBeNull();
  });

  it('closes the pinned card on its close button', () => {
    renderWithMantine(<DBTimeChart config={config} />);
    pin();

    act(() => {
      callback(cardProps().onClose, 'onClose')();
    });

    expect(cardProps().pinned).toBe(false);
  });

  it('closes the pinned card on Escape', () => {
    renderWithMantine(<DBTimeChart config={config} />);
    pin();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    expect(cardProps().pinned).toBe(false);
  });

  it('dismisses the pinned card when a click lands on the plot area', () => {
    renderWithMantine(<DBTimeChart config={config} />);
    pin();

    act(() => {
      chartProps().setIsClickActive(undefined);
    });

    expect(cardProps().pinned).toBe(false);
  });

  it('keeps the pin authoritative over a later hover', () => {
    renderWithMantine(<DBTimeChart config={config} />);
    pin();

    const other: Exemplar = { ...exemplar, traceId: 'other', value: 99 };
    act(() => {
      callback(chartProps().onExemplarHover, 'onExemplarHover')(other, 99, 99);
    });

    expect(cardProps().hovered?.exemplar.traceId).toBe(exemplar.traceId);
  });
});
