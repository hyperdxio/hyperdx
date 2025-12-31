import React from 'react';

import api from '@/api';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';
import { useSource } from '@/source';

import { DBTimeChart } from '../DBTimeChart';

// Mock dependencies
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

jest.mock('@/api', () => ({
  __esModule: true,
  default: {
    useMe: jest.fn(),
  },
}));

jest.mock('@/source', () => ({
  useSource: jest.fn(),
}));

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
});
