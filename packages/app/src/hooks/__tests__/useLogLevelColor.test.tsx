import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import { formatResponseForTimeChart } from '@/ChartUtils';
import { useAppTheme } from '@/theme/ThemeProvider';
import {
  CHART_INFO_HEX_BY_BRAND,
  getChartColorError,
  getChartColorWarning,
  logLevelColor,
} from '@/utils';

import { useLogLevelColor } from '../useLogLevelColor';

jest.mock('@/theme/ThemeProvider', () => ({
  useAppTheme: jest.fn(),
}));

const mockUseMantineTheme = jest.fn();
const mockUseMantineColorScheme = jest.fn();

jest.mock('@mantine/core', () => {
  const actual = jest.requireActual('@mantine/core');
  return {
    ...actual,
    useMantineTheme: () => mockUseMantineTheme(),
    useMantineColorScheme: () => mockUseMantineColorScheme(),
  };
});

const mockUseAppTheme = useAppTheme as jest.Mock;

const hyperdxGreens = [
  '#0',
  '#1',
  '#2',
  '#3',
  '#4',
  '#5',
  '#00a475',
  '#008362',
];

const logLevelFixture = {
  data: [
    {
      'count()': '1',
      SeverityText: 'info',
      __hdx_time_bucket: '2025-11-26T12:23:00Z',
    },
  ],
  meta: [
    { name: 'count()', type: 'UInt64' },
    { name: 'SeverityText', type: 'LowCardinality(String)' },
    { name: '__hdx_time_bucket', type: 'DateTime' },
  ],
};

describe('useLogLevelColor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-mantine-color-scheme');
  });

  it('uses Mantine green-6 for HyperDX dark info rows', () => {
    mockUseAppTheme.mockReturnValue({ themeName: 'hyperdx' });
    mockUseMantineTheme.mockReturnValue({ colors: { green: hyperdxGreens } });
    mockUseMantineColorScheme.mockReturnValue({ colorScheme: 'dark' });

    const { result } = renderHook(() => useLogLevelColor());
    expect(result.current('info')).toBe(CHART_INFO_HEX_BY_BRAND.hyperdx.dark);
    expect(result.current('error')).toBe(getChartColorError());
    expect(result.current('warn')).toBe(getChartColorWarning());
  });

  it('uses Mantine green-7 for HyperDX light info rows', () => {
    mockUseAppTheme.mockReturnValue({ themeName: 'hyperdx' });
    mockUseMantineTheme.mockReturnValue({ colors: { green: hyperdxGreens } });
    mockUseMantineColorScheme.mockReturnValue({ colorScheme: 'light' });

    const { result } = renderHook(() => useLogLevelColor());
    expect(result.current('info')).toBe(CHART_INFO_HEX_BY_BRAND.hyperdx.light);
  });

  it('falls back to logLevelColor on ClickStack', () => {
    mockUseAppTheme.mockReturnValue({ themeName: 'clickstack' });
    mockUseMantineTheme.mockReturnValue({ colors: { green: hyperdxGreens } });
    mockUseMantineColorScheme.mockReturnValue({ colorScheme: 'dark' });

    const { result } = renderHook(() => useLogLevelColor());
    expect(result.current).toBe(logLevelColor);
  });

  it('falls back to logLevelColor when HyperDX green palette is missing', () => {
    mockUseAppTheme.mockReturnValue({ themeName: 'hyperdx' });
    mockUseMantineTheme.mockReturnValue({ colors: {} });
    mockUseMantineColorScheme.mockReturnValue({ colorScheme: 'dark' });

    const { result } = renderHook(() => useLogLevelColor());
    expect(result.current).toBe(logLevelColor);
  });
});

describe('useLogLevelColor with formatResponseForTimeChart', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-mantine-color-scheme');
  });

  it('assigns HyperDX Mantine green via logLevelColorFn', () => {
    mockUseAppTheme.mockReturnValue({ themeName: 'hyperdx' });
    mockUseMantineTheme.mockReturnValue({ colors: { green: hyperdxGreens } });
    mockUseMantineColorScheme.mockReturnValue({ colorScheme: 'dark' });

    const { result } = renderHook(() => useLogLevelColor());
    const formatted = formatResponseForTimeChart({
      currentPeriodResponse: logLevelFixture,
      dateRange: [new Date(), new Date()],
      granularity: '1 minute',
      generateEmptyBuckets: false,
      source: {
        kind: SourceKind.Log,
        severityTextExpression: 'SeverityText',
      },
      logLevelColorFn: result.current,
    });

    expect(formatted.lineData[0]?.color).toBe(
      CHART_INFO_HEX_BY_BRAND.hyperdx.dark,
    );
  });

  it('assigns ClickStack chart blue via default logLevelColor', () => {
    document.documentElement.classList.add('theme-clickstack');

    const formatted = formatResponseForTimeChart({
      currentPeriodResponse: logLevelFixture,
      dateRange: [new Date(), new Date()],
      granularity: '1 minute',
      generateEmptyBuckets: false,
      source: {
        kind: SourceKind.Log,
        severityTextExpression: 'SeverityText',
      },
    });

    expect(formatted.lineData[0]?.color).toBe(
      CHART_INFO_HEX_BY_BRAND.clickstack.dark,
    );
  });
});
