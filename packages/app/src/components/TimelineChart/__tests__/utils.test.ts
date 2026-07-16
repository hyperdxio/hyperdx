import {
  calculateInterval,
  getMaxEventValue,
  MIN_TICK_PX,
  renderMs,
  tickIntervalForWidth,
} from '@/components/TimelineChart/utils';

describe('renderMs', () => {
  it('formats sub-second values as ms', () => {
    expect(renderMs(500)).toBe('500ms');
    expect(renderMs(999)).toBe('999ms');
  });

  it('rounds sub-second values', () => {
    expect(renderMs(999.4)).toBe('999ms');
    expect(renderMs(999.6)).toBe('1000ms');
  });

  it('formats whole seconds without decimals', () => {
    expect(renderMs(1000)).toBe('1s');
    expect(renderMs(2000)).toBe('2s');
    expect(renderMs(5000)).toBe('5s');
  });

  it('formats fractional seconds with three decimals', () => {
    expect(renderMs(1500)).toBe('1.500s');
    expect(renderMs(1234.567)).toBe('1.235s');
  });

  it('returns "0µs" for 0', () => {
    expect(renderMs(0)).toBe('0µs');
  });

  it('formats sub-millisecond values as µs', () => {
    expect(renderMs(0.001)).toBe('1µs');
    expect(renderMs(0.5)).toBe('500µs');
    expect(renderMs(0.999)).toBe('999µs');
  });

  it('rounds sub-millisecond values to nearest µs', () => {
    expect(renderMs(0.0005)).toBe('1µs');
    expect(renderMs(0.9994)).toBe('999µs');
  });

  it('falls through to ms when µs rounds to 1000', () => {
    // 0.9995ms rounds to 1000µs, so it should render as 1ms instead
    expect(renderMs(0.9995)).toBe('1ms');
  });

  describe('with a tick interval (step)', () => {
    it('adds ms precision so adjacent ticks stay distinct', () => {
      expect(renderMs(1, 0.5)).toBe('1.0ms');
      expect(renderMs(1.5, 0.5)).toBe('1.5ms');
      expect(renderMs(2, 0.5)).toBe('2.0ms');
      expect(renderMs(2.5, 0.5)).toBe('2.5ms');
    });

    it('produces no duplicate labels across a 0.5ms-spaced axis', () => {
      const interval = 0.5;
      const labels = [];
      for (let i = 0; i * interval <= 4; i++) {
        labels.push(renderMs(i * interval, interval));
      }
      expect(new Set(labels).size).toBe(labels.length);
    });

    it('uses two decimals when the interval requires it', () => {
      expect(renderMs(1, 0.05)).toBe('1.00ms');
      expect(renderMs(1.05, 0.05)).toBe('1.05ms');
      expect(renderMs(1.1, 0.05)).toBe('1.10ms');
    });

    it('keeps integer labels when the interval is a whole number', () => {
      expect(renderMs(2, 2)).toBe('2ms');
      expect(renderMs(50, 50)).toBe('50ms');
    });

    it('adds precision to sub-millisecond (µs) ticks', () => {
      expect(renderMs(0.5, 0.5)).toBe('500µs');
      expect(renderMs(0.0005, 0.0005)).toBe('0.5µs');
      expect(renderMs(0.001, 0.0005)).toBe('1.0µs');
      expect(renderMs(0.0015, 0.0005)).toBe('1.5µs');
    });

    it('falls through to ms (with ms precision) when the µs form rounds to 1000', () => {
      expect(renderMs(0.99996, 0.0005)).toBe('1.0000ms');
      expect(renderMs(0.9999, 0.05)).toBe('1.00ms');
      expect(renderMs(0.9996, 0.5)).toBe('1.0ms');
    });

    it('adds precision to second-scale ticks', () => {
      expect(renderMs(1000, 500)).toBe('1.0s');
      expect(renderMs(1500, 500)).toBe('1.5s');
      expect(renderMs(2000, 500)).toBe('2.0s');
    });

    describe('edge cases', () => {
      it('treats a null step like an omitted step (no added precision)', () => {
        // @ts-expect-error null is not assignable to step, but is guarded at runtime
        expect(renderMs(1, null)).toBe('1ms');
        // @ts-expect-error null is not assignable to step, but is guarded at runtime
        expect(renderMs(0.5, null)).toBe('500µs');
        // @ts-expect-error null is not assignable to step, but is guarded at runtime
        expect(renderMs(1500, null)).toBe('1.500s');
        // @ts-expect-error null is not assignable to step, but is guarded at runtime
        expect(renderMs(2000, null)).toBe('2s');
      });

      it('adds no precision for a 0 step', () => {
        expect(renderMs(1, 0)).toBe('1ms');
        expect(renderMs(0.5, 0)).toBe('500µs');
        expect(renderMs(1000, 0)).toBe('1s');
        expect(renderMs(1500, 0)).toBe('2s');
      });

      it('adds no precision for a negative step', () => {
        expect(renderMs(1, -0.5)).toBe('1ms');
        expect(renderMs(0.5, -0.0005)).toBe('500µs');
        expect(renderMs(1000, -500)).toBe('1s');
      });

      it('adds no precision for a non-finite step', () => {
        expect(renderMs(1, Infinity)).toBe('1ms');
        expect(renderMs(1, NaN)).toBe('1ms');
      });
    });
  });
});

describe('calculateInterval', () => {
  it('returns 0.5 for value 5 (small values)', () => {
    expect(calculateInterval(5)).toBe(0.5);
  });

  it('returns magnitude 1 bucket for value 10', () => {
    expect(calculateInterval(10)).toBe(1);
  });

  it('snaps up to 5x magnitude for value 25', () => {
    // value/10 = 2.5 → smallest fitting bucket is 5 (snap up), giving 5 ticks
    expect(calculateInterval(25)).toBe(5);
  });

  it('returns 5x magnitude for value 50', () => {
    expect(calculateInterval(50)).toBe(5);
  });

  it('returns magnitude 10 for value 100', () => {
    expect(calculateInterval(100)).toBe(10);
  });

  it('returns 2x10 for value 200', () => {
    expect(calculateInterval(200)).toBe(20);
  });

  it('returns 5x10 for value 500', () => {
    expect(calculateInterval(500)).toBe(50);
  });

  it('returns magnitude 100 for value 1000', () => {
    expect(calculateInterval(1000)).toBe(100);
  });

  it('never produces more than maxTicks steps', () => {
    for (const [value, maxTicks] of [
      [1000, 10],
      [1000, 5],
      [1000, 2],
      [1000, 1],
      [37, 6],
      [250, 3],
    ] as const) {
      const interval = calculateInterval(value, maxTicks);
      expect(Math.floor(value / interval)).toBeLessThanOrEqual(maxTicks);
    }
  });

  it('thins ticks as the budget shrinks', () => {
    // A tighter tick budget must yield a coarser (>=) interval.
    expect(calculateInterval(1000, 5)).toBeGreaterThanOrEqual(
      calculateInterval(1000, 10),
    );
    expect(calculateInterval(1000, 2)).toBeGreaterThanOrEqual(
      calculateInterval(1000, 5),
    );
  });

  it('returns a safe fallback for non-positive ranges', () => {
    expect(calculateInterval(0)).toBe(1);
    expect(calculateInterval(-5)).toBe(1);
  });
});

describe('tickIntervalForWidth', () => {
  it('budgets ticks by MIN_TICK_PX, matching calculateInterval', () => {
    // 560px fits 10 ticks (560 / 56), so a 100ms range steps by 10ms.
    expect(tickIntervalForWidth(100, 10 * MIN_TICK_PX)).toBe(
      calculateInterval(100, 10),
    );
  });

  it('yields finer intervals as the width grows', () => {
    // A narrow axis packs fewer ticks (coarser interval); a wide one packs more
    // (finer interval). This is what lets the cursor readout gain precision when
    // the timeline is zoomed in.
    const narrow = tickIntervalForWidth(100, 3 * MIN_TICK_PX);
    const wide = tickIntervalForWidth(100, 20 * MIN_TICK_PX);
    expect(wide).toBeLessThan(narrow);
  });

  it('formats a cursor time with the same precision as the tick labels', () => {
    // A zoomed-in 5ms range across a wide axis steps by a sub-ms interval, so
    // the readout keeps a decimal instead of rounding to a whole millisecond.
    const interval = tickIntervalForWidth(5, 20 * MIN_TICK_PX);
    expect(renderMs(2.3, interval)).toBe('2.3ms');
    expect(renderMs(2.3)).toBe('2ms');
  });

  it('reserves at least one tick for tiny widths', () => {
    expect(tickIntervalForWidth(100, 0)).toBe(calculateInterval(100, 1));
    expect(tickIntervalForWidth(100, MIN_TICK_PX / 2)).toBe(
      calculateInterval(100, 1),
    );
  });
});

describe('getMaxEventValue', () => {
  it('returns the max event end plus 10% padding', () => {
    const rows = [
      { events: [{ end: 100 }, { end: 250 }] },
      { events: [{ end: 300 }] },
    ];
    expect(getMaxEventValue(rows)).toBeCloseTo(330);
  });

  it('ignores rows with no events and finds the global max', () => {
    const rows = [
      { events: [] },
      { events: [{ end: 50 }] },
      { events: [{ end: 10 }, { end: 500 }] },
    ];
    expect(getMaxEventValue(rows)).toBeCloseTo(550);
  });

  it('returns 0 for empty input', () => {
    expect(getMaxEventValue([])).toBe(0);
    expect(getMaxEventValue([{ events: [] }])).toBe(0);
  });
});
