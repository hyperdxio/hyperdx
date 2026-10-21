import React from 'react';
import { BuilderChartConfigWithDateRange } from '@hyperdx/common-utils/dist/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';

import { useGroupedPatterns } from '@/hooks/usePatterns';

let mockSampleRows: Record<string, unknown>[];

jest.mock('@/components/DBRowTable', () => ({
  useConfigWithAdditionalSelect: (config: object) => ({
    ...config,
    additionalKeysLength: 0,
  }),
}));
jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: () => ({
    data: { data: mockSampleRows },
    isLoading: false,
    error: null,
  }),
}));

// Every sample mines into one pattern.
const fakePyodide = {
  loadPackage: async () => {},
  pyimport: () => ({ install: async () => {} }),
  globals: { set: () => {} },
  runPythonAsync: async (code: string) =>
    code.includes('add_log_message')
      ? JSON.stringify(
          mockSampleRows.map(() => ({ cluster_id: 1, template_mined: 'x' })),
        )
      : undefined,
};

describe('useGroupedPatterns', () => {
  const config: BuilderChartConfigWithDateRange = {
    connection: 'conn',
    from: { databaseName: 'default', tableName: 'otel_logs' },
    select: '',
    where: '',
    whereLanguage: 'sql',
    timestampValueExpression: 'Timestamp',
    dateRange: [
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-01T01:00:00Z'),
    ],
  };

  beforeEach(() => {
    Object.assign(window, { loadPyodide: async () => fakePyodide });
  });

  it("carries the last sample's severity number onto the pattern row", async () => {
    mockSampleRows = [
      {
        __hdx_pattern_field: 'x',
        __hdx_timestamp: '2024-01-01T00:10:00Z',
        __hdx_level: 'info',
        __hyperdx_severity_number: 9,
      },
      {
        __hdx_pattern_field: 'x',
        __hdx_timestamp: '2024-01-01T00:20:00Z',
        __hdx_level: '',
        __hyperdx_severity_number: 17,
      },
    ];
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const { result } = renderHook(
      () =>
        useGroupedPatterns({
          config,
          samples: 2,
          bodyValueExpression: 'Body',
          levelExpression: 'SeverityText',
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    );

    await waitFor(() =>
      expect(result.current.data['1']).toMatchObject({
        level: '',
        __hyperdx_severity_number: 17,
      }),
    );
  });
});
