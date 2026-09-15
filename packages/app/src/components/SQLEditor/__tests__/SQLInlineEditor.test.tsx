import React from 'react';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import SQLInlineEditor from '@/components/SQLEditor/SQLInlineEditor';
import { useMultipleAllFields } from '@/hooks/useMetadata';

jest.mock('@/hooks/useMetadata', () => ({
  useMultipleAllFields: jest.fn().mockReturnValue({ data: [] }),
}));

jest.mock('@/source', () => ({
  useSource: jest.fn().mockReturnValue({ data: undefined }),
}));

// Already typed as the mocked shape — jest.mocked on the real import would
// instead demand a full UseQueryResult from a stub that only needs `data`.
const mockUseSource = jest.requireMock<{ useSource: jest.Mock }>(
  '@/source',
).useSource;

const tableConnection = {
  databaseName: 'db',
  tableName: 'table',
  connectionId: 'conn-1',
};

describe('SQLInlineEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // The whole point of passing sourceId anywhere: it must resolve here.
  it("resolves sourceId to that source's timestampValueExpression for Map-key discovery", () => {
    mockUseSource.mockReturnValue({
      data: {
        id: 'src-1',
        name: 'Test Source',
        kind: SourceKind.Log,
        connection: 'conn-1',
        from: { databaseName: 'db', tableName: 'table' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Body',
      },
    });

    renderWithMantine(
      <SQLInlineEditor
        tableConnection={tableConnection}
        value=""
        onChange={() => {}}
        sourceId="src-1"
      />,
    );

    expect(mockUseSource).toHaveBeenCalledWith({ id: 'src-1' });
    expect(useMultipleAllFields).toHaveBeenCalledWith(
      [tableConnection],
      expect.objectContaining({ timestampValueExpression: 'Timestamp' }),
    );
  });

  it('passes an empty timestampValueExpression through when the source has none yet', () => {
    // A prior test's mockReturnValue survives clearAllMocks, so pin this
    // one back rather than relying on the module-level default.
    mockUseSource.mockReturnValue({ data: undefined });

    renderWithMantine(
      <SQLInlineEditor
        tableConnection={tableConnection}
        value=""
        onChange={() => {}}
        sourceId="src-1"
      />,
    );

    expect(useMultipleAllFields).toHaveBeenCalledWith(
      [tableConnection],
      expect.objectContaining({ timestampValueExpression: undefined }),
    );
  });

  // QueryExpressionFilterEditForm and ChartSeriesEditor both forgot this.
  it("merges the resolved source's metadataMVs into a hand-built tableConnection missing it", () => {
    const metadataMaterializedViews = {
      kvRollupTable: 'otel_logs_kv_rollup_15m',
      granularity: '15 minute' as const,
    };
    mockUseSource.mockReturnValue({
      data: {
        id: 'src-1',
        name: 'Test Source',
        kind: SourceKind.Log,
        connection: 'conn-1',
        from: { databaseName: 'db', tableName: 'table' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Body',
        metadataMaterializedViews,
      },
    });

    renderWithMantine(
      <SQLInlineEditor
        tableConnection={tableConnection}
        value=""
        onChange={() => {}}
        sourceId="src-1"
      />,
    );

    expect(useMultipleAllFields).toHaveBeenCalledWith(
      [{ ...tableConnection, metadataMVs: metadataMaterializedViews }],
      expect.anything(),
    );
  });

  it('does not merge metadataMVs or timestampValueExpression when sourceId names a different table than tableConnection (e.g. a cross-source trace ID editor)', () => {
    mockUseSource.mockReturnValue({
      data: {
        id: 'src-1',
        name: 'A Different Source',
        kind: SourceKind.Log,
        connection: 'conn-1',
        from: { databaseName: 'db', tableName: 'other-table' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Body',
        metadataMaterializedViews: {
          kvRollupTable: 'other_table_kv_rollup_15m',
          granularity: '15 minute' as const,
        },
      },
    });

    renderWithMantine(
      <SQLInlineEditor
        tableConnection={tableConnection}
        value=""
        onChange={() => {}}
        sourceId="src-1"
      />,
    );

    expect(useMultipleAllFields).toHaveBeenCalledWith(
      [tableConnection],
      expect.objectContaining({ timestampValueExpression: undefined }),
    );
  });

  it('does not merge metadataMVs or timestampValueExpression when sourceId names the same database.table on a different connection', () => {
    // Same-named schemas across separate connections (e.g. staging and
    // production) must not borrow each other's rollup or time column.
    mockUseSource.mockReturnValue({
      data: {
        id: 'src-1',
        name: 'Same Table, Other Connection',
        kind: SourceKind.Log,
        connection: 'conn-2',
        from: { databaseName: 'db', tableName: 'table' },
        timestampValueExpression: 'Timestamp',
        defaultTableSelectExpression: 'Body',
        metadataMaterializedViews: {
          kvRollupTable: 'otel_logs_kv_rollup_15m',
          granularity: '15 minute' as const,
        },
      },
    });

    renderWithMantine(
      <SQLInlineEditor
        tableConnection={tableConnection}
        value=""
        onChange={() => {}}
        sourceId="src-1"
      />,
    );

    expect(useMultipleAllFields).toHaveBeenCalledWith(
      [tableConnection],
      expect.objectContaining({ timestampValueExpression: undefined }),
    );
  });

  it('does not merge metadataMVs for a metric source, which has none, but still resolves its timestampValueExpression', () => {
    // A metric source's from.tableName is empty by design, so table
    // identity for it can't require a tableName match.
    mockUseSource.mockReturnValue({
      data: {
        id: 'src-1',
        name: 'Test Metric Source',
        kind: SourceKind.Metric,
        connection: 'conn-1',
        from: { databaseName: 'db', tableName: '' },
        timestampValueExpression: 'Timestamp',
        metricTables: {},
      },
    });

    renderWithMantine(
      <SQLInlineEditor
        tableConnection={tableConnection}
        value=""
        onChange={() => {}}
        sourceId="src-1"
      />,
    );

    expect(useMultipleAllFields).toHaveBeenCalledWith(
      [tableConnection],
      expect.objectContaining({ timestampValueExpression: 'Timestamp' }),
    );
  });
});
