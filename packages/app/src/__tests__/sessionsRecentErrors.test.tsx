import { renderHook, waitFor } from '@testing-library/react';

import { clearRecentErrors, getRecentErrors } from '@/recentErrors';
import { useRRWebEventStream } from '@/sessions';

jest.mock('@hyperdx/common-utils/dist/core/renderChartConfig', () => ({
  renderChartConfig: jest
    .fn()
    .mockResolvedValue({ sql: 'SELECT 1', params: {} }),
}));
jest.mock('@/hooks/useMetadata', () => ({
  useMetadataWithSettings: () => ({}),
}));
jest.mock('@/source', () => ({
  SESSION_TABLE_EXPRESSIONS: {},
  useSource: () => ({ data: { id: 's1', connection: 'c1' } }),
}));
jest.mock('@/clickhouse', () => ({
  useClickhouseClient: jest.fn(),
  getClickhouseClient: () => ({
    query: jest
      .fn()
      .mockRejectedValue(new Error('Table default.rrweb does not exist')),
  }),
}));

afterEach(() => clearRecentErrors());

it('records a failed session replay stream in the recent errors', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});

  renderHook(() =>
    useRRWebEventStream({
      serviceName: 'web',
      sessionId: 'abc',
      sourceId: 's1',
      startDate: new Date(0),
      endDate: new Date(1000),
      getSessionSourceFieldExpression: (column, key) => `${column}['${key}']`,
    }),
  );

  await waitFor(() =>
    expect(getRecentErrors().map(e => e.message)).toContain(
      'Table default.rrweb does not exist',
    ),
  );
});
