import React from 'react';
import { Exemplar } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { act, render } from '@testing-library/react';

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

jest.mock('@/components/MaterializedViews/MVOptimizationIndicator', () =>
  jest.fn(() => null),
);
jest.mock('@/components/charts/DateRangeIndicator', () => jest.fn(() => null));
jest.mock('@/components/charts/ChartSeriesTooltip', () => ({
  ChartSeriesTooltip: () => <div data-testid="series-tooltip" />,
}));

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

  describe('range changes', () => {
    // Both cards are positioned from pixel coordinates captured at pin/hover
    // time, so anything that moves the markers leaves them beside the wrong
    // diamond. A marker sliding out from under a stationary cursor fires no
    // mouseleave, so the hover card cannot clean itself up.
    //
    // `wrapper` rather than renderWithMantine: it keeps the provider outside the
    // rerendered element, so DBTimeChart stays at the same tree position and
    // keeps its state. Rerendering a differently-shaped tree remounts the chart,
    // which clears the cards by itself and would let these pass with the effect
    // removed entirely.
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <MantineProvider>{children}</MantineProvider>
    );

    let rerenderChart: ((ui: React.ReactElement) => void) | null = null;

    const renderAt = (dateRange: [Date, Date]) => {
      const { rerender } = render(
        <DBTimeChart config={{ ...config, dateRange }} />,
        { wrapper },
      );
      rerenderChart = rerender;
    };

    const moveTo = (dateRange: [Date, Date]) =>
      act(() => {
        if (!rerenderChart) throw new Error('renderAt was not called');
        rerenderChart(<DBTimeChart config={{ ...config, dateRange }} />);
      });

    const initialRange: [Date, Date] = [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-02T00:00:05Z'),
    ];
    const zoomedRange: [Date, Date] = [
      new Date('2024-06-01T00:00:00Z'),
      new Date('2024-06-02T00:00:05Z'),
    ];

    it('clears a pinned card when the range changes', () => {
      renderAt(initialRange);
      pin();
      expect(cardProps().pinned).toBe(true);

      moveTo(zoomedRange);

      expect(cardProps().pinned).toBe(false);
      expect(cardProps().hovered).toBeNull();
    });

    it('clears a hover card when the range changes with nothing pinned', () => {
      // The case an earlier version missed: it keyed the effect on there being a
      // pin, so a hover-only card survived the zoom at stale coordinates and kept
      // the series tooltip suppressed.
      renderAt(initialRange);
      act(() => {
        callback(chartProps().onExemplarHover, 'onExemplarHover')(
          exemplar,
          10,
          20,
        );
      });
      expect(cardProps().hovered).toEqual({ exemplar, x: 10, y: 20 });
      expect(cardProps().pinned).toBe(false);

      moveTo(zoomedRange);

      expect(cardProps().hovered).toBeNull();
    });

    it('keeps a pinned card across a live-tail tick', () => {
      // dateRange advances every second while live-tailing; the exemplar query
      // quantises to a 30s bucket so those ticks stay one cache entry, and the
      // card must not be yanked away a moment after the user clicked it. The end
      // sits mid-bucket, as a live range does — a boundary-aligned one would
      // cross into the next bucket on the very first tick.
      renderAt(initialRange);
      pin();

      moveTo([initialRange[0], new Date(initialRange[1].getTime() + 1000)]);

      expect(cardProps().pinned).toBe(true);
    });
  });

  // The drill-down tooltip and the exemplar card share `dismissPinned`, and main's
  // capture-phase mousedown listener is a new caller of it. mousedown fires before
  // click, so pinning a marker while the tooltip is open runs dismissPinned first
  // and pinExemplarCard second. Nothing asserted that ordering, so a regression in
  // it would have passed the whole suite.
  describe('outside-click dismissal (ported from #2748)', () => {
    const openTooltip = () =>
      act(() => {
        callback(
          chartProps().setIsClickActive,
          'setIsClickActive',
        )({
          viewportX: 10,
          viewportY: 20,
          activeLabel: '1704067200',
          activePayload: [
            { dataKey: 'count', name: 'count', value: 1 },
          ] as never,
        });
      });

    it('dismisses the drill-down tooltip on a real outside mousedown', () => {
      const { queryByTestId } = renderWithMantine(
        <DBTimeChart config={config} />,
      );
      openTooltip();
      expect(queryByTestId('series-tooltip')).not.toBeNull();

      act(() => {
        document.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
      });

      expect(queryByTestId('series-tooltip')).toBeNull();
    });

    it('leaves the exemplar pin intact when a marker click also dismisses the tooltip', () => {
      const { queryByTestId } = renderWithMantine(
        <DBTimeChart config={config} />,
      );
      openTooltip();

      // Real event order for a click on a marker while the tooltip is open.
      act(() => {
        document.dispatchEvent(
          new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
        );
      });
      pin();

      // The pin is the last write and must win over dismissPinned's unpin.
      expect(cardProps().pinned).toBe(true);
      expect(chartProps().pinnedExemplarKey).toBe(
        `exemplar-${exemplar.traceId}-${exemplar.timestamp}`,
      );
      expect(queryByTestId('series-tooltip')).toBeNull();
    });
  });
});
