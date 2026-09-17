import { Exemplar } from '@hyperdx/common-utils/dist/types';
import { act, renderHook } from '@testing-library/react';

import { useExemplarMarkers } from '@/HDXMultiSeriesTimeChart/useExemplarMarkers';

/**
 * Every bug this layer has had came from a card outliving the marker it points
 * at. There are two ways that happens: the marker leaves the rendered set, or it
 * stays and moves. The second is what these cases are about — the cards are
 * positioned from the pixel coordinates the SVG shape reported at hover or click
 * time, and the x-domain is what maps a data point to those pixels.
 */
const HOUR = 3600;
const BASE = 1_700_000_000;

const exemplar: Exemplar = {
  // Inside the base window below.
  timestamp: (BASE + HOUR / 2) * 1000,
  value: 42,
  traceId: 'abc123',
};
const exemplarKey = `exemplar-${exemplar.traceId}-${exemplar.timestamp}`;

const args = (overrides: Record<string, unknown> = {}) => ({
  exemplars: [exemplar],
  maxExemplars: 100,
  granularity: '1 minute',
  pinnedExemplarKey: null as string | null,
  xAxisDomain: [BASE, BASE + HOUR] as [number, number],
  exemplarYBounds: { min: 0, max: 100 },
  onExemplarHoverEnd: jest.fn(),
  onExemplarPinEnd: jest.fn(),
  onExemplarPositionsChanged: jest.fn(),
  onExemplarsDropped: jest.fn(),
  suppressNextClickRef: { current: false },
  brushOriginRef: { current: null as number | null },
  ...overrides,
});

describe('useExemplarMarkers active marker', () => {
  // Only the marker the card describes reports its position — every marker doing
  // so would be a callback per marker per frame, and nothing reads the rest.
  it('marks the pinned marker active', () => {
    const { result } = renderHook(() =>
      useExemplarMarkers(args({ pinnedExemplarKey: exemplarKey })),
    );

    expect(result.current.activeExemplarKey).toBe(exemplarKey);
  });

  it('has no active marker when nothing is hovered or pinned', () => {
    const { result } = renderHook(() => useExemplarMarkers(args()));

    expect(result.current.activeExemplarKey).toBeNull();
  });

  it('lets the pin outrank a hover, matching which card is shown', () => {
    // The card shows pinned ?? hovered, so position reports have to follow the
    // same precedence or a hover would re-anchor the pinned card.
    const { result } = renderHook(() =>
      useExemplarMarkers(args({ pinnedExemplarKey: exemplarKey })),
    );

    act(() => {
      result.current.handleExemplarHoverStart(
        { ...exemplar, traceId: 'other' },
        1,
        2,
      );
    });

    expect(result.current.activeExemplarKey).toBe(exemplarKey);
  });
});

describe('useExemplarMarkers rendered set', () => {
  it('still closes a pinned card whose marker leaves the rendered set', () => {
    // The pre-existing guard, kept honest alongside the new one.
    const initial = args({ pinnedExemplarKey: exemplarKey });
    const { rerender } = renderHook(props => useExemplarMarkers(props), {
      initialProps: initial,
    });

    rerender({ ...initial, exemplars: [] });

    expect(initial.onExemplarPinEnd).toHaveBeenCalled();
  });

  it('drops a marker outside the rendered window rather than dragging it in', () => {
    const { result } = renderHook(() =>
      useExemplarMarkers(
        args({
          exemplars: [{ ...exemplar, timestamp: (BASE - 10 * HOUR) * 1000 }],
        }),
      ),
    );

    expect(result.current.exemplarPoints).toEqual([]);
  });

  it('renders a marker inside the window at its own value', () => {
    const { result } = renderHook(() => useExemplarMarkers(args()));

    expect(result.current.exemplarPoints).toHaveLength(1);
    expect(result.current.exemplarPoints[0].y).toBe(exemplar.value);
  });
});
