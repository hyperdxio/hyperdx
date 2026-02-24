import React from 'react';
import { act, screen } from '@testing-library/react';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useMVOptimizationExplanation } from '@/hooks/useMVOptimizationExplanation';
import { useSource } from '@/source';
import { formatNumber } from '@/utils';

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
}));

jest.mock('@/utils', () => ({
  formatNumber: jest.fn(),
  omit: jest.fn((obj: Record<string, unknown>, keys: string[]) => {
    const result = { ...obj };
    keys.forEach((key: string) => delete result[key]);
    return result;
  }),
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
});
