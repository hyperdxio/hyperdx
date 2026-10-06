import {
  BuilderChartConfigWithDateRange,
  DisplayType,
} from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import { useConfigWithSelectAliases } from '@/hooks/useConfigWithSelectAliases';

const mockUseAliasMap = jest.fn();

jest.mock('@/hooks/useChartConfig', () => ({
  useAliasMapFromChartConfig: (...args: unknown[]) => mockUseAliasMap(...args),
}));

const config: BuilderChartConfigWithDateRange = {
  displayType: DisplayType.Search,
  connection: 'test-connection',
  from: { databaseName: 'default', tableName: 'otel_logs' },
  select: 'Timestamp, ServiceName as service, Body',
  where: "service = 'api'",
  whereLanguage: 'sql',
  timestampValueExpression: 'Timestamp',
  dateRange: [new Date('2025-01-01'), new Date('2025-01-02')],
};

describe('useConfigWithSelectAliases', () => {
  beforeEach(() => {
    mockUseAliasMap.mockReset();
  });

  it('defines the select aliases in `with` and keeps the rest of the config', () => {
    mockUseAliasMap.mockReturnValue({
      data: { service: 'ServiceName' },
      isLoading: false,
    });

    const { result } = renderHook(() => useConfigWithSelectAliases(config));

    expect(result.current.config).toEqual({
      ...config,
      with: [
        {
          name: 'service',
          sql: { sql: 'ServiceName', params: {} },
          isSubquery: false,
        },
      ],
    });
  });

  it('resolves the aliases from the config it was given', () => {
    mockUseAliasMap.mockReturnValue({ data: {}, isLoading: false });

    renderHook(() => useConfigWithSelectAliases(config));

    expect(mockUseAliasMap).toHaveBeenCalledWith(config);
  });

  it.each([
    ['an empty alias map', {}],
    ['no alias map yet', undefined],
  ])('keeps the config as is with %s', (_label, data) => {
    mockUseAliasMap.mockReturnValue({ data, isLoading: false });

    const { result } = renderHook(() => useConfigWithSelectAliases(config));

    expect(result.current.config).toEqual(config);
    expect(result.current.config.with).toBeUndefined();
  });

  it('keeps its own `with` when the select has no aliases', () => {
    const existingWith: BuilderChartConfigWithDateRange['with'] = [
      { name: 'total', sql: { sql: '1', params: {} }, isSubquery: false },
    ];
    mockUseAliasMap.mockReturnValue({ data: {}, isLoading: false });

    const { result } = renderHook(() =>
      useConfigWithSelectAliases({ ...config, with: existingWith }),
    );

    expect(result.current.config.with).toBe(existingWith);
  });

  it.each([true, false])('reports isLoading=%s from the alias map', loading => {
    mockUseAliasMap.mockReturnValue({ data: undefined, isLoading: loading });

    const { result } = renderHook(() => useConfigWithSelectAliases(config));

    expect(result.current.isLoading).toBe(loading);
  });

  it('returns the same config object until its inputs change', () => {
    const data = { service: 'ServiceName' };
    mockUseAliasMap.mockReturnValue({ data, isLoading: false });

    const { result, rerender } = renderHook(() =>
      useConfigWithSelectAliases(config),
    );
    const first = result.current.config;
    rerender();

    expect(result.current.config).toBe(first);
  });
});
