import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { formatNumber } from '@/utils';

import { NumberFormat } from '../../types';
import DBNumberChart from '../DBNumberChart';
import { NumberFormatInput } from '../NumberFormat';

// Mock dependencies
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

jest.mock('@/utils', () => ({
  formatNumber: jest.fn(),
  omit: jest.fn((obj: Record<string, unknown>, keys: string[]) => {
    const result = { ...obj };
    keys.forEach((key: string) => delete result[key]);
    return result;
  }),
}));

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
});
