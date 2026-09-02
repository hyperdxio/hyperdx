import React from 'react';
import { DisplayType } from '@hyperdx/common-utils/dist/types';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fromPartial } from '@total-typescript/shoehorn';

import api from '@/api';
import { ChartKeyJoiner } from '@/ChartUtils';
import DateRangeIndicator from '@/components/charts/DateRangeIndicator';
import {
  DBTimeChart,
  decodeSeriesGroupFilters,
} from '@/components/DBTimeChart';
import MVOptimizationIndicator from '@/components/MaterializedViews/MVOptimizationIndicator';
import { MAX_LOADABLE_TIME_CHART_SERIES } from '@/defaults';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';

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

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: jest.fn(),
  },
}));

jest.mock('@/source', () => ({
  useSource: jest.fn(),
  useChartNumberFormats: jest
    .fn()
    .mockReturnValue({ formatByColumn: new Map(), chartFormat: undefined }),
}));

jest.mock('../MaterializedViews/MVOptimizationIndicator', () =>
  jest.fn(() => null),
);

jest.mock('../charts/DateRangeIndicator', () => jest.fn(() => null));

describe('DBTimeChart', () => {
  const mockUseQueriedChartConfig = useQueriedChartConfig as jest.Mock;
  const mockUseMe = api.useMe as jest.Mock;
  const mockUseSource = useSource as jest.Mock;

  const baseTestConfig = {
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
        data: [{ timestamp: 1704067200, value: 100 }],
        meta: [],
        rows: 1,
        isComplete: true,
      },
      isLoading: false,
      isError: false,
      isSuccess: true,
      isPlaceholderData: false,
    });
  });

  it('passes enabled: false to useQueriedChartConfig for previous period when compareToPreviousPeriod is undefined', () => {
    const config = {
      ...baseTestConfig,
      compareToPreviousPeriod: undefined,
    };

    renderWithMantine(<DBTimeChart config={config} />);

    // Get the second call (previous period query)
    const [, secondCallOptions] = mockUseQueriedChartConfig.mock.calls[1];

    // Verify that enabled is false for the previous period query
    expect(secondCallOptions.enabled).toBe(false);
  });

  it('passes enabled: true to useQueriedChartConfig for previous period when compareToPreviousPeriod is true', () => {
    const config = {
      ...baseTestConfig,
      compareToPreviousPeriod: true,
    };

    renderWithMantine(<DBTimeChart config={config} />);

    // Get the second call (previous period query)
    const [, secondCallOptions] = mockUseQueriedChartConfig.mock.calls[1];

    // Verify that enabled is true for the previous period query
    expect(secondCallOptions.enabled).toBe(true);
  });

  it('passes enabled: false to useQueriedChartConfig for previous period when compareToPreviousPeriod is false', () => {
    const config = {
      ...baseTestConfig,
      compareToPreviousPeriod: false,
    };

    renderWithMantine(<DBTimeChart config={config} />);

    // Get the second call (previous period query)
    const [, secondCallOptions] = mockUseQueriedChartConfig.mock.calls[1];

    // Verify that enabled is false for the previous period query
    expect(secondCallOptions.enabled).toBe(false);
  });

  it('respects the enabled prop when determining if previous period query should run', () => {
    const config = {
      ...baseTestConfig,
      compareToPreviousPeriod: true,
    };

    // Render with enabled=false
    renderWithMantine(<DBTimeChart config={config} enabled={false} />);

    // Get the second call (previous period query)
    const [, secondCallOptions] = mockUseQueriedChartConfig.mock.calls[1];

    // Verify that enabled is false even when compareToPreviousPeriod is true
    // because the enabled prop is false
    expect(secondCallOptions.enabled).toBe(false);
  });

  it('passes the same config to useMVOptimizationExplanation, useQueriedChartConfig, and MVOptimizationIndicator', () => {
    // Mock useSource to return a source so MVOptimizationIndicator is rendered
    jest.mocked(useSource).mockReturnValue(
      fromPartial<ReturnType<typeof useSource>>({
        data: { id: 'test-source', name: 'Test Source' },
      }),
    );

    renderWithMantine(<DBTimeChart config={baseTestConfig} />);

    // Get the config that was passed to useMVOptimizationExplanation
    expect(jest.mocked(useMVOptimizationExplanation)).toHaveBeenCalled();
    const mvOptExplanationConfig = jest.mocked(useMVOptimizationExplanation)
      .mock.calls[0][0];

    // Get the config that was passed to useQueriedChartConfig (first call is the main query)
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

  it('disables the MV-optimization query when both MV and date-range indicators are hidden', () => {
    jest.mocked(useSource).mockReturnValue(
      fromPartial<ReturnType<typeof useSource>>({
        data: { id: 'test-source', name: 'Test Source' },
      }),
    );

    renderWithMantine(
      <DBTimeChart
        config={baseTestConfig}
        showMVOptimizationIndicator={false}
        showDateRangeIndicator={false}
      />,
    );

    expect(jest.mocked(useMVOptimizationExplanation)).toHaveBeenCalled();
    const options = jest.mocked(useMVOptimizationExplanation).mock.calls[0][1];
    expect(options?.enabled).toBe(false);
  });

  it('keeps the MV-optimization query enabled when only the date-range indicator is shown', () => {
    jest.mocked(useSource).mockReturnValue(
      fromPartial<ReturnType<typeof useSource>>({
        data: { id: 'test-source', name: 'Test Source' },
      }),
    );

    renderWithMantine(
      <DBTimeChart
        config={baseTestConfig}
        showMVOptimizationIndicator={false}
        showDateRangeIndicator
      />,
    );

    const options = jest.mocked(useMVOptimizationExplanation).mock.calls[0][1];
    expect(options?.enabled).toBe(true);
  });

  describe('load-all series escape hatch', () => {
    // A high-cardinality group-by response: MAX_RENDERED_TIME_CHART_SERIES (250)
    // default cap + 50 extra groups, so 50 series are hidden and the
    // HiddenSeriesIndicator surfaces the load-all affordance.
    const HIDDEN = 50;
    const GROUP_COUNT = 250 + HIDDEN;

    const highCardinalityData = Array.from({ length: GROUP_COUNT }, (_, i) => ({
      timestamp: 1704067200,
      value: i + 1,
      group: `g${i}`,
    }));
    const highCardinalityMeta = [
      { name: 'timestamp', type: 'DateTime' },
      { name: 'value', type: 'UInt64' },
      { name: 'group', type: 'String' },
    ];

    const groupByConfig = {
      ...baseTestConfig,
      groupBy: 'group',
    };

    beforeEach(() => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: {
          data: highCardinalityData,
          meta: highCardinalityMeta,
          rows: GROUP_COUNT,
          isComplete: true,
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      });
    });

    it('surfaces the load-all button when the render cap hides series, then hides it after loading all', async () => {
      const user = userEvent.setup();
      renderWithMantine(<DBTimeChart config={groupByConfig} />);

      // 50 series over the default 250 cap => the load-all affordance appears.
      const loadAllButton = await screen.findByRole('button', {
        name: /load all .* series/i,
      });
      expect(loadAllButton).toBeInTheDocument();

      await user.click(loadAllButton);

      // After loading all, every series is materialized (bounded, but far above
      // GROUP_COUNT), so nothing is hidden and the affordance disappears.
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /load all .* series/i }),
        ).not.toBeInTheDocument();
      });
    });

    it('keeps the load-all opt-in across an unrelated re-render with a fresh-but-equal config', async () => {
      // Regression for the reset effect firing on every render: dashboard tiles
      // pass a fresh config object literal each render (e.g. on hover), so a
      // reset keyed on config/queriedConfig identity would snap showAllSeries
      // back to false and re-cap the chart. The opt-in must survive a re-render
      // whose config is a new object with identical query shape.
      const user = userEvent.setup();
      const { rerender } = renderWithMantine(
        <DBTimeChart config={groupByConfig} />,
      );

      const loadAllButton = await screen.findByRole('button', {
        name: /load all .* series/i,
      });
      await user.click(loadAllButton);
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /load all .* series/i }),
        ).not.toBeInTheDocument();
      });

      // Re-render with a brand-new object AND a genuinely shifted time window
      // (a new dateRange, mimicking a live-range tick / zoom). dateRange is
      // deliberately excluded from the shape identity, so the opt-in must
      // survive — this also guards against dateRange being reintroduced into
      // queryShapeIdentity, which would make live-range ticks re-cap the chart.
      rerender(
        <MantineProvider>
          <Notifications />
          <DBTimeChart
            config={{
              ...groupByConfig,
              dateRange: [new Date('2024-02-01'), new Date('2024-02-02')] as [
                Date,
                Date,
              ],
            }}
          />
        </MantineProvider>,
      );

      // The opt-in survives: no series are re-hidden, so the affordance stays
      // gone. (Before the fix, the reset effect fired here and it reappeared.)
      expect(
        screen.queryByRole('button', { name: /load all .* series/i }),
      ).not.toBeInTheDocument();
    });

    it('resets the load-all opt-in when the query shape changes (e.g. seriesLimit re-authored)', async () => {
      // The reset must still fire for a genuine query change: after loading all,
      // re-authoring the tile (here, tightening seriesLimit) re-applies the cap.
      const user = userEvent.setup();
      const { rerender } = renderWithMantine(
        <DBTimeChart config={groupByConfig} />,
      );

      const loadAllButton = await screen.findByRole('button', {
        name: /load all .* series/i,
      });
      await user.click(loadAllButton);
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /load all .* series/i }),
        ).not.toBeInTheDocument();
      });

      // Change the query shape (a positive seriesLimit below GROUP_COUNT keeps
      // series hidden), which should reset the opt-in and re-show the affordance.
      rerender(
        <MantineProvider>
          <Notifications />
          <DBTimeChart config={{ ...groupByConfig, seriesLimit: 5 }} />
        </MantineProvider>,
      );

      expect(
        await screen.findByRole('button', { name: /load all .* series/i }),
      ).toBeInTheDocument();
    });

    it('does not hide series (no load-all affordance) when seriesLimit is 0 (unlimited)', () => {
      renderWithMantine(
        <DBTimeChart config={{ ...groupByConfig, seriesLimit: 0 }} />,
      );

      // seriesLimit=0 resolves to an unlimited render cap, so no series are
      // dropped and the load-all affordance never appears.
      expect(
        screen.queryByRole('button', { name: /load all .* series/i }),
      ).not.toBeInTheDocument();
    });

    it('goes passive (non-clickable) after load-all when the result still exceeds the load-all bound', async () => {
      // A result larger than MAX_LOADABLE_TIME_CHART_SERIES (5000): after
      // clicking "load all", the cap is lifted to the bound but series remain
      // hidden. Clicking again could not reveal more (showAllSeries is already
      // true), so the indicator must drop its onLoadAll action rather than
      // render a button that no-ops.
      const user = userEvent.setup();
      const BIG_GROUP_COUNT = MAX_LOADABLE_TIME_CHART_SERIES + 100;
      const bigData = Array.from({ length: BIG_GROUP_COUNT }, (_, i) => ({
        timestamp: 1704067200,
        value: i + 1,
        group: `g${i}`,
      }));
      mockUseQueriedChartConfig.mockReturnValue({
        data: {
          data: bigData,
          meta: highCardinalityMeta,
          rows: BIG_GROUP_COUNT,
          isComplete: true,
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      });

      renderWithMantine(<DBTimeChart config={groupByConfig} />);

      const loadAllButton = await screen.findByRole('button', {
        name: /load all .* series/i,
      });
      await user.click(loadAllButton);

      // Series are still hidden (result > bound), but the affordance is now a
      // passive warning icon, not a clickable button.
      await waitFor(() => {
        expect(
          screen.queryByRole('button', { name: /load all .* series/i }),
        ).not.toBeInTheDocument();
      });
    });
  });

  it('renders DateRangeIndicator when MV optimization returns a different date range', () => {
    const originalStartDate = new Date('2024-01-01T00:00:30Z');
    const originalEndDate = new Date('2024-01-01T01:30:45Z');
    const alignedStartDate = new Date('2024-01-01T00:00:00Z');
    const alignedEndDate = new Date('2024-01-01T02:00:00Z');

    const config = {
      ...baseTestConfig,
      alignDateRangeToGranularity: false,
      dateRange: [originalStartDate, originalEndDate] as [Date, Date],
    };

    // Mock useMVOptimizationExplanation to return an optimized config with aligned date range
    jest.mocked(useMVOptimizationExplanation).mockReturnValue(
      fromPartial<ReturnType<typeof useMVOptimizationExplanation>>({
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
      }),
    );

    renderWithMantine(<DBTimeChart config={config} />);

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

  it('renders DateRangeIndicator when alignDateRangeToGranularity is true and results in a different date range', () => {
    const originalStartDate = new Date('2024-01-01T00:00:30Z');
    const originalEndDate = new Date('2024-01-01T01:30:45Z');
    const alignedStartDate = new Date('2024-01-01T00:00:00Z');
    const alignedEndDate = new Date('2024-01-01T01:35:00Z');

    const config = {
      ...baseTestConfig,
      alignDateRangeToGranularity: true,
      granularity: '5 minute',
      dateRange: [originalStartDate, originalEndDate] as [Date, Date],
    };

    // Mock useMVOptimizationExplanation to return no optimized config
    jest.mocked(useMVOptimizationExplanation).mockReturnValue(
      fromPartial<ReturnType<typeof useMVOptimizationExplanation>>({
        data: {
          optimizedConfig: undefined,
          explanations: [],
        },
        isLoading: false,
        isPlaceholderData: false,
      }),
    );

    renderWithMantine(<DBTimeChart config={config} />);

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
    expect(dateRangeIndicatorCall.mvGranularity).toBeUndefined();
  });

  describe('raw SQL line chart', () => {
    const rawSqlConfig = {
      configType: 'sql' as const,
      sqlTemplate:
        'SELECT toStartOfInterval(ts, INTERVAL {intervalSeconds:Int64} SECOND) AS ts, count() AS count FROM logs GROUP BY ts ORDER BY ts ASC',
      connection: 'test-connection',
      displayType: DisplayType.Line,
      dateRange: [new Date('2024-01-01'), new Date('2024-01-02')] as [
        Date,
        Date,
      ],
    };

    it('passes the raw SQL config directly to useQueriedChartConfig without converting it', () => {
      renderWithMantine(<DBTimeChart config={rawSqlConfig} />);

      const firstCallConfig = mockUseQueriedChartConfig.mock.calls[0][0];
      // The config should be passed as-is, not wrapped by convertToTimeChartConfig
      // (which would add `limit`, `dateRangeEndInclusive`, etc.)
      expect(firstCallConfig.configType).toBe('sql');
      expect(firstCallConfig.sqlTemplate).toBe(rawSqlConfig.sqlTemplate);
      expect(firstCallConfig).not.toHaveProperty('limit');
    });

    it('does not pass the raw SQL config to useMVOptimizationExplanation', () => {
      renderWithMantine(<DBTimeChart config={rawSqlConfig} />);

      // useMVOptimizationExplanation should be called with undefined for raw SQL configs
      expect(
        jest.mocked(useMVOptimizationExplanation).mock.calls[0][0],
      ).toBeUndefined();
    });

    it('renders without crashing when query returns timestamp and value columns', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: {
          data: [
            { ts: 1704067200, count: 42 },
            { ts: 1704067260, count: 17 },
          ],
          meta: [
            { name: 'ts', type: 'DateTime' },
            { name: 'count', type: 'UInt64' },
          ],
          rows: 2,
          isComplete: true,
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      });

      // Should render without throwing
      expect(() =>
        renderWithMantine(<DBTimeChart config={rawSqlConfig} />),
      ).not.toThrow();
    });

    it('renders without crashing when query returns no data', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: {
          data: [],
          meta: [],
          rows: 0,
          isComplete: true,
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      });

      expect(() =>
        renderWithMantine(<DBTimeChart config={rawSqlConfig} />),
      ).not.toThrow();
    });

    it('renders without crashing when query returns multiple value columns', () => {
      mockUseQueriedChartConfig.mockReturnValue({
        data: {
          data: [
            { ts: 1704067200, errors: 5, warnings: 12 },
            { ts: 1704067260, errors: 3, warnings: 8 },
          ],
          meta: [
            { name: 'ts', type: 'DateTime' },
            { name: 'errors', type: 'UInt64' },
            { name: 'warnings', type: 'UInt64' },
          ],
          rows: 2,
          isComplete: true,
        },
        isLoading: false,
        isError: false,
        isSuccess: true,
        isPlaceholderData: false,
      });

      expect(() =>
        renderWithMantine(<DBTimeChart config={rawSqlConfig} />),
      ).not.toThrow();
    });
  });

  describe('decodeSeriesGroupFilters', () => {
    it('maps a single-group series key to a column/value filter', () => {
      expect(
        decodeSeriesGroupFilters({
          seriesKey: 'error',
          groupColumns: ['severityText'],
          isSingleValueColumn: true,
        }),
      ).toEqual([{ column: 'severityText', value: 'error' }]);
    });

    it('maps a multi-group series key to one filter per group column, in order', () => {
      const seriesKey = ['error', 'api'].join(ChartKeyJoiner);
      expect(
        decodeSeriesGroupFilters({
          seriesKey,
          groupColumns: ['severityText', 'service'],
          isSingleValueColumn: true,
        }),
      ).toEqual([
        { column: 'severityText', value: 'error' },
        { column: 'service', value: 'api' },
      ]);
    });

    it('drops the leading value column when the series is not single-value', () => {
      const seriesKey = ['errors', 'error'].join(ChartKeyJoiner);
      expect(
        decodeSeriesGroupFilters({
          seriesKey,
          groupColumns: ['severityText'],
          isSingleValueColumn: false,
        }),
      ).toEqual([{ column: 'severityText', value: 'error' }]);
    });

    it('returns no filters when there are no group columns', () => {
      expect(
        decodeSeriesGroupFilters({
          seriesKey: 'count',
          groupColumns: [],
          isSingleValueColumn: true,
        }),
      ).toEqual([]);
    });

    it('returns no filters when the series key is undefined', () => {
      expect(
        decodeSeriesGroupFilters({
          seriesKey: undefined,
          groupColumns: ['severityText'],
          isSingleValueColumn: true,
        }),
      ).toEqual([]);
    });
  });

  it('does not render DateRangeIndicator when MV optimization has no optimized date range and showDateRangeIndicator is false', () => {
    // Mock useMVOptimizationExplanation to return data without an optimized config
    jest.mocked(useMVOptimizationExplanation).mockReturnValue(
      fromPartial<ReturnType<typeof useMVOptimizationExplanation>>({
        data: {
          optimizedConfig: undefined,
          explanations: [],
        },
        isLoading: false,
        isPlaceholderData: false,
      }),
    );

    renderWithMantine(
      <DBTimeChart config={baseTestConfig} showDateRangeIndicator={false} />,
    );

    // Verify DateRangeIndicator was not called
    expect(jest.mocked(DateRangeIndicator)).not.toHaveBeenCalled();
  });
});
