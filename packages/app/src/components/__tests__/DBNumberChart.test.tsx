import React from 'react';
import { act, screen } from '@testing-library/react';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';
import { formatNumber, getColorFromCSSToken } from '@/utils';

import { NumberFormat } from '../../types';
import DateRangeIndicator from '../charts/DateRangeIndicator';
import DBNumberChart from '../DBNumberChart';
import MVOptimizationIndicator from '../MaterializedViews/MVOptimizationIndicator';

// Mock dependencies
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

jest.mock('@/hooks/useMVOptimizationExplanation', () => ({
  useMVOptimizationExplanation: jest.fn().mockReturnValue({
    data: undefined,
    isLoading: false,
    isPlaceholderData: false,
  }),
}));

jest.mock('@/source', () => ({
  useSource: jest.fn().mockReturnValue({ data: null }),
  useSingleSeriesNumberFormat: jest
    .fn()
    .mockImplementation((config: any) => config.numberFormat),
}));

jest.mock('@/utils', () => ({
  formatNumber: jest.fn(),
  omit: jest.fn((obj: Record<string, unknown>, keys: string[]) => {
    const result = { ...obj };
    keys.forEach((key: string) => delete result[key]);
    return result;
  }),
  // The renderer resolves palette tokens through getColorFromCSSToken.
  // Return a valid CSS hex so Mantine applies it as an inline color style,
  // letting us assert that the resolved value reaches the DOM element.
  getColorFromCSSToken: jest.fn(() => '#00ff00'),
  // Use the real resolver so integration tests verify the actual logic.
  resolveConditionalColor:
    jest.requireActual('@/utils').resolveConditionalColor,
}));

jest.mock('../MaterializedViews/MVOptimizationIndicator', () =>
  jest.fn(() => null),
);

jest.mock('../charts/DateRangeIndicator', () => jest.fn(() => null));

describe('DBNumberChart', () => {
  const mockUseQueriedChartConfig = useQueriedChartConfig as jest.Mock;
  const mockFormatNumber = formatNumber as jest.Mock;

  const baseTestConfig = {
    dateRange: [new Date(), new Date()] as [Date, Date],
    from: { databaseName: 'test', tableName: 'test' },
    timestampValueExpression: 'timestamp',
    connection: 'test-connection',
    select: '',
    where: '',
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockUseQueriedChartConfig.mockReturnValue({
      data: { data: [{ value: 1234 }] },
      isLoading: false,
      isError: false,
    });

    // Mock formatNumber to isolate just testing the chart component
    mockFormatNumber.mockImplementation((value, format) => {
      if (!format) return value.toString();

      if (format.output === 'percent') return `${value}%`;
      if (format.output === 'currency') return `$${value}`;

      return `${value} (formatted with ${format.output})`;
    });
  });

  it('renders the number with default formatting when no numberFormat is provided', () => {
    renderWithMantine(<DBNumberChart config={baseTestConfig} />);
    expect(mockFormatNumber).toHaveBeenCalledWith(1234, undefined);
  });

  it('renders the number with the provided numberFormat', () => {
    const config = {
      ...baseTestConfig,
      numberFormat: {
        output: 'percent' as const,
        mantissa: 2,
        thousandSeparated: true,
      },
    };

    renderWithMantine(<DBNumberChart config={config} />);
    expect(mockFormatNumber).toHaveBeenCalledWith(1234, config.numberFormat);
  });

  it('updates the display when numberFormat changes', async () => {
    let setNumberFormatFn: (format: NumberFormat) => void;
    const TestComponent = () => {
      const [numberFormat, setNumberFormat] = React.useState<
        NumberFormat | undefined
      >(undefined);
      // eslint-disable-next-line react-hooks/globals
      setNumberFormatFn = setNumberFormat;
      return <DBNumberChart config={{ ...baseTestConfig, numberFormat }} />;
    };

    renderWithMantine(<TestComponent />);

    const newFormat = {
      output: 'currency' as const,
      mantissa: 0,
      thousandSeparated: true,
    };
    act(() => setNumberFormatFn(newFormat));

    expect(mockFormatNumber).toHaveBeenCalledWith(1234, newFormat);
  });

  it('includes numberFormat in the query key to ensure re-fetching when format changes', () => {
    const numberFormat = {
      output: 'percent' as const,
      mantissa: 2,
    };

    const config = {
      ...baseTestConfig,
      numberFormat,
    };

    renderWithMantine(<DBNumberChart config={config} queryKeyPrefix="test" />);

    const [firstCall] = mockUseQueriedChartConfig.mock.calls;
    const [, { queryKey }] = firstCall;
    const [, { numberFormat: queryKeyFormat }] = queryKey;

    expect(queryKeyFormat).toEqual(numberFormat);
  });

  it('displays formatted number in the UI', () => {
    const config = {
      ...baseTestConfig,
      numberFormat: {
        output: 'currency' as const,
        mantissa: 2,
        thousandSeparated: true,
      },
    };

    renderWithMantine(<DBNumberChart config={config} />);
    expect(screen.getByText('$1234')).toBeInTheDocument();
  });

  it('handles zero values correctly', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: { data: [{ value: 0 }] },
      isLoading: false,
      isError: false,
    });

    const config = {
      ...baseTestConfig,
      numberFormat: {
        output: 'percent' as const,
        mantissa: 1,
      },
    };

    renderWithMantine(<DBNumberChart config={config} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('displays NaN for null or undefined values', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: { data: [{ value: null }] },
      isLoading: false,
      isError: false,
    });

    renderWithMantine(<DBNumberChart config={baseTestConfig} />);
    expect(screen.getByText('NaN')).toBeInTheDocument();
  });

  it('handles loading state correctly', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });

    renderWithMantine(<DBNumberChart config={baseTestConfig} />);
    expect(screen.getByText('Loading Chart Data...')).toBeInTheDocument();
  });

  it('handles error state correctly', () => {
    mockUseQueriedChartConfig.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('Test error'),
    });

    renderWithMantine(<DBNumberChart config={baseTestConfig} />);
    expect(screen.getByText(/Error loading chart/)).toBeInTheDocument();
  });

  it('passes the same config to useMVOptimizationExplanation, useQueriedChartConfig, and MVOptimizationIndicator', () => {
    // Mock useSource to return a source so MVOptimizationIndicator is rendered
    jest.mocked(useSource).mockReturnValue({
      data: { id: 'test-source', name: 'Test Source' },
    } as any);

    renderWithMantine(<DBNumberChart config={baseTestConfig} />);

    // Get the config that was passed to useMVOptimizationExplanation
    expect(jest.mocked(useMVOptimizationExplanation)).toHaveBeenCalled();
    const mvOptExplanationConfig = jest.mocked(useMVOptimizationExplanation)
      .mock.calls[0][0];

    // Get the config that was passed to useQueriedChartConfig
    expect(jest.mocked(useQueriedChartConfig)).toHaveBeenCalled();
    const queriedChartConfig = jest.mocked(useQueriedChartConfig).mock
      .calls[0][0];

    // Get the config that was passed to MVOptimizationIndicator
    expect(jest.mocked(MVOptimizationIndicator)).toHaveBeenCalled();
    const indicatorConfig = jest.mocked(MVOptimizationIndicator).mock
      .calls[0][0].config;

    // All three should receive the same config object reference
    expect(mvOptExplanationConfig).toBe(queriedChartConfig);
    expect(queriedChartConfig).toBe(indicatorConfig);
    expect(mvOptExplanationConfig).toBe(indicatorConfig);
  });

  it('renders DateRangeIndicator when MV optimization returns a different date range', () => {
    const originalStartDate = new Date('2024-01-01T00:00:30Z');
    const originalEndDate = new Date('2024-01-01T01:30:45Z');
    const alignedStartDate = new Date('2024-01-01T00:00:00Z');
    const alignedEndDate = new Date('2024-01-01T02:00:00Z');

    const config = {
      ...baseTestConfig,
      dateRange: [originalStartDate, originalEndDate] as [Date, Date],
    };

    // Mock useMVOptimizationExplanation to return an optimized config with aligned date range
    jest.mocked(useMVOptimizationExplanation).mockReturnValue({
      data: {
        optimizedConfig: {
          ...config,
          dateRange: [alignedStartDate, alignedEndDate] as [Date, Date],
        },
        explanations: [
          {
            success: true,
            mvConfig: {
              minGranularity: '1 minute',
              tableName: 'metrics_rollup_1m',
            },
          },
        ],
      },
      isLoading: false,
      isPlaceholderData: false,
    } as any);

    renderWithMantine(<DBNumberChart config={config} />);

    // Verify DateRangeIndicator was called
    expect(jest.mocked(DateRangeIndicator)).toHaveBeenCalled();

    // Verify it was called with the correct props
    const dateRangeIndicatorCall =
      jest.mocked(DateRangeIndicator).mock.calls[0][0];
    expect(dateRangeIndicatorCall.originalDateRange).toEqual([
      originalStartDate,
      originalEndDate,
    ]);
    expect(dateRangeIndicatorCall.effectiveDateRange).toEqual([
      alignedStartDate,
      alignedEndDate,
    ]);
    expect(dateRangeIndicatorCall.mvGranularity).toBe('1 minute');
  });

  it('does not render DateRangeIndicator when MV optimization has no optimized date range', () => {
    // Mock useMVOptimizationExplanation to return data without an optimized config
    jest.mocked(useMVOptimizationExplanation).mockReturnValue({
      data: {
        optimizedConfig: undefined,
        explanations: [],
      },
      isLoading: false,
      isPlaceholderData: false,
    } as any);

    renderWithMantine(<DBNumberChart config={baseTestConfig} />);

    // Verify DateRangeIndicator was not called
    expect(jest.mocked(DateRangeIndicator)).not.toHaveBeenCalled();
  });

  describe('colorRules (conditional colors)', () => {
    const mockGetColorFromCSSToken = getColorFromCSSToken as jest.Mock;

    beforeEach(() => {
      // Each test controls the data value independently
      mockGetColorFromCSSToken.mockImplementation(() => '#00ff00');
    });

    function setDataValue(v: number) {
      mockUseQueriedChartConfig.mockReturnValue({
        data: { data: [{ value: v }] },
        isLoading: false,
        isError: false,
      });
    }

    it('uses static color when no rule matches (value 50, threshold ≥ 100)', () => {
      setDataValue(50);
      // formatNumber is mocked; make it return the raw value so we can query by text
      mockFormatNumber.mockReturnValue('50');
      const config = {
        ...baseTestConfig,
        color: 'chart-success' as const,
        colorRules: [
          {
            operator: 'gte' as const,
            value: 100,
            color: 'chart-warning' as const,
          },
          {
            operator: 'gte' as const,
            value: 500,
            color: 'chart-error' as const,
          },
        ],
      };
      renderWithMantine(<DBNumberChart config={config} />);
      // resolveConditionalColor returns 'chart-success' (fallback); getColorFromCSSToken called with it
      expect(mockGetColorFromCSSToken).toHaveBeenCalledWith('chart-success');
    });

    it('applies warning color when value is 200 (≥ 100 but < 500)', () => {
      setDataValue(200);
      mockFormatNumber.mockReturnValue('200');
      const config = {
        ...baseTestConfig,
        color: 'chart-success' as const,
        colorRules: [
          {
            operator: 'gte' as const,
            value: 100,
            color: 'chart-warning' as const,
          },
          {
            operator: 'gte' as const,
            value: 500,
            color: 'chart-error' as const,
          },
        ],
      };
      renderWithMantine(<DBNumberChart config={config} />);
      expect(mockGetColorFromCSSToken).toHaveBeenCalledWith('chart-warning');
    });

    it('applies error color when value is 1000 (both rules match, last wins)', () => {
      setDataValue(1000);
      mockFormatNumber.mockReturnValue('1000');
      const config = {
        ...baseTestConfig,
        color: 'chart-success' as const,
        colorRules: [
          {
            operator: 'gte' as const,
            value: 100,
            color: 'chart-warning' as const,
          },
          {
            operator: 'gte' as const,
            value: 500,
            color: 'chart-error' as const,
          },
        ],
      };
      renderWithMantine(<DBNumberChart config={config} />);
      expect(mockGetColorFromCSSToken).toHaveBeenCalledWith('chart-error');
    });

    it('falls back to undefined (default text color) when no static color and no rule matches', () => {
      setDataValue(10);
      mockFormatNumber.mockReturnValue('10');
      const config = {
        ...baseTestConfig,
        // No static color set
        colorRules: [
          {
            operator: 'gte' as const,
            value: 100,
            color: 'chart-warning' as const,
          },
        ],
      };
      renderWithMantine(<DBNumberChart config={config} />);
      expect(mockGetColorFromCSSToken).not.toHaveBeenCalled();
    });

    it('coerces string data values (ClickHouse UInt64) to numbers for rule evaluation', () => {
      // ClickHouse returns UInt64 as a JSON string when quote_64bit_integers is set
      mockUseQueriedChartConfig.mockReturnValue({
        data: { data: [{ value: '1000' }] },
        isLoading: false,
        isError: false,
      });
      mockFormatNumber.mockReturnValue('1000');
      const config = {
        ...baseTestConfig,
        color: 'chart-success' as const,
        colorRules: [
          {
            operator: 'gte' as const,
            value: 100,
            color: 'chart-warning' as const,
          },
          {
            operator: 'gte' as const,
            value: 500,
            color: 'chart-error' as const,
          },
        ],
      };
      renderWithMantine(<DBNumberChart config={config} />);
      // String "1000" coerced to 1000 matches both rules; last (error) wins
      expect(mockGetColorFromCSSToken).toHaveBeenCalledWith('chart-error');
    });
  });

  describe('color', () => {
    const mockGetColorFromCSSToken = getColorFromCSSToken as jest.Mock;

    it('resolves a palette token through getColorFromCSSToken when config.color is set', () => {
      const config = {
        ...baseTestConfig,
        color: 'chart-success' as const,
      };

      renderWithMantine(<DBNumberChart config={config} />);

      expect(mockGetColorFromCSSToken).toHaveBeenCalledWith('chart-success');
      // Verify the resolved color reaches the <Text> DOM element so a
      // regression that drops the `c` prop or passes undefined is caught.
      const textEl = screen.getByText('1234');
      expect(textEl).toBeInTheDocument();
      expect(textEl).toHaveStyle({ color: 'rgb(0, 255, 0)' });
    });

    it('does not resolve a color when config.color is unset', () => {
      renderWithMantine(<DBNumberChart config={baseTestConfig} />);

      expect(mockGetColorFromCSSToken).not.toHaveBeenCalled();
      expect(screen.getByText('1234')).toBeInTheDocument();
    });

    it('skips resolution and renders the default when config.color is not a known palette token', () => {
      const config = {
        ...baseTestConfig,
        // Simulate a legacy or hand-edited dashboard with an unknown
        // value sneaking past the schema (e.g. an old hex code).
        color: 'definitely-not-a-token' as any,
      };

      renderWithMantine(<DBNumberChart config={config} />);

      expect(mockGetColorFromCSSToken).not.toHaveBeenCalled();
      expect(screen.getByText('1234')).toBeInTheDocument();
    });

    it('migrates legacy chart-1..10 tokens to their hue-named equivalent at render time', () => {
      // Defense in depth: in practice `normalizeDashboardTileColors` in
      // `packages/app/src/dashboard.ts` heals legacy tokens at fetch
      // time, so renderers should always see hue-named values. But any
      // tile constructed in memory (e.g. from a preset or a unit test)
      // can still carry a legacy `chart-1`, so the renderer also
      // resolves through `resolveChartPaletteToken` before the
      // CSS-token lookup.
      const config = {
        ...baseTestConfig,
        color: 'chart-1' as any,
      };

      renderWithMantine(<DBNumberChart config={config} />);

      expect(mockGetColorFromCSSToken).toHaveBeenCalledWith('chart-green');
      const textEl = screen.getByText('1234');
      expect(textEl).toHaveStyle({ color: 'rgb(0, 255, 0)' });
    });
  });

  describe('auto-sized font', () => {
    it('renders the value with a pixel-based font size so the tile can resize it', () => {
      renderWithMantine(<DBNumberChart config={baseTestConfig} />);

      const textEl = screen.getByText('1234');
      const fontSize = textEl.style.fontSize;

      // The value should be sized in px (set by AutoSizeNumber's
      // ResizeObserver-driven calculation) rather than the previous
      // hard-coded "4rem". Anything non-empty ending in "px" indicates
      // the auto-sizing path is active.
      expect(fontSize).toMatch(/px$/);
    });

    it('does not let the value wrap to multiple lines', () => {
      renderWithMantine(<DBNumberChart config={baseTestConfig} />);
      const textEl = screen.getByText('1234');
      // Long numbers should shrink to fit on a single line rather
      // than wrap and visually break the tile.
      expect(textEl.style.whiteSpace).toBe('nowrap');
    });

    /**
     * Drives the binary-search measurement pass by faking the DOM
     * geometry that the AutoSizeNumber component reads:
     *
     *  - container.clientWidth / clientHeight  -> available tile size
     *  - text.scrollWidth / scrollHeight       -> rendered text size at
     *    the current font-size, modeled as proportional to the assigned
     *    font-size in px and the length of the text (a reasonable
     *    approximation of how a real browser would lay it out).
     *
     * With those mocks in place we can assert that the picked font size
     * actually shrinks for narrow containers and grows for wide ones.
     */
    const installGeometryMocks = (
      containerWidth: number,
      containerHeight: number,
      // px of width per character at 1px font; tweak so realistic numbers
      // produce realistic measurements during the binary search.
      widthPerChar = 0.6,
    ) => {
      const containerSpy = jest
        .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
        .mockImplementation(function (this: HTMLElement) {
          return this.tagName === 'DIV' ? containerWidth : 0;
        });
      const containerHeightSpy = jest
        .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
        .mockImplementation(function (this: HTMLElement) {
          return this.tagName === 'DIV' ? containerHeight : 0;
        });
      const scrollWidthSpy = jest
        .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
        .mockImplementation(function (this: HTMLElement) {
          if (this.tagName !== 'P') return 0;
          const fs = parseFloat(this.style.fontSize) || 0;
          return Math.ceil((this.textContent ?? '').length * widthPerChar * fs);
        });
      const scrollHeightSpy = jest
        .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
        .mockImplementation(function (this: HTMLElement) {
          if (this.tagName !== 'P') return 0;
          const fs = parseFloat(this.style.fontSize) || 0;
          // line-height: 1.1
          return Math.ceil(fs * 1.1);
        });

      return () => {
        containerSpy.mockRestore();
        containerHeightSpy.mockRestore();
        scrollWidthSpy.mockRestore();
        scrollHeightSpy.mockRestore();
      };
    };

    it('shrinks the font for a narrow tile so the value fits without overflow', () => {
      const restore = installGeometryMocks(120, 80);
      try {
        mockUseQueriedChartConfig.mockReturnValue({
          data: { data: [{ value: 1234567890 }] },
          isLoading: false,
          isError: false,
        });

        renderWithMantine(<DBNumberChart config={baseTestConfig} />);

        const textEl = screen.getByText('1234567890');
        const fontSize = parseFloat(textEl.style.fontSize);

        // Available width after padding (12 px each side) is 96 px.
        // 10 chars * 0.6 width-per-char = 6 px/char, so the largest
        // font size that fits is floor(96 / (10 * 0.6)) = 16 px. Picked
        // size must be <= 16 and >= the configured min of 10 px.
        expect(fontSize).toBeLessThanOrEqual(16);
        expect(fontSize).toBeGreaterThanOrEqual(10);
      } finally {
        restore();
      }
    });

    it('grows the font for a wide tile so the value fills the available space', () => {
      const restore = installGeometryMocks(800, 400);
      try {
        renderWithMantine(<DBNumberChart config={baseTestConfig} />);

        const textEl = screen.getByText('1234');
        const fontSize = parseFloat(textEl.style.fontSize);

        // 4 chars * 0.6 = 2.4 px per font-size px, so a 800-px-wide
        // container could theoretically fit very large fonts; the
        // auto-sizer should clamp to the configured max (72 px).
        expect(fontSize).toBeGreaterThanOrEqual(60);
        expect(fontSize).toBeLessThanOrEqual(72);
      } finally {
        restore();
      }
    });
  });

  describe('error boundary fallback', () => {
    /**
     * Force the auto-sizer's measurement pipeline to throw by making
     * `clientWidth` raise an error during the layout effect. The
     * surrounding ErrorBoundary should catch the failure and fall back
     * to the simpler fixed-size rendering, which still shows the value
     * (so dashboards never go blank because of a measurement bug).
     */
    it('falls back to a simpler text rendering if AutoSizeNumber throws', () => {
      const containerSpy = jest
        .spyOn(HTMLElement.prototype, 'clientWidth', 'get')
        .mockImplementation(function (this: HTMLElement) {
          if (this.tagName === 'DIV') {
            throw new Error('boom: simulated layout failure');
          }
          return 0;
        });

      // ErrorBoundary logs the caught error to console.error; silence
      // it so the test output stays focused on the assertions.
      const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      try {
        renderWithMantine(<DBNumberChart config={baseTestConfig} />);

        const textEl = screen.getByText('1234');
        expect(textEl).toBeInTheDocument();

        // The fallback uses Mantine's `size="4rem"` rather than an
        // inline px font-size, so the auto-sized inline style should
        // not be present on the rendered element.
        expect(textEl.style.fontSize).toBe('');
      } finally {
        containerSpy.mockRestore();
        errSpy.mockRestore();
      }
    });
  });
});
