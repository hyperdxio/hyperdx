import { SourceKind, TLogSource } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import {
  getJSONColumnNames,
  getMapColumnNames,
  useRowData,
} from '@/components/DBRowDataPanel';
import { useQueriedChartConfig } from '@/hooks/useChartConfig';

jest.mock('@/hooks/useChartConfig', () => ({
  useQueriedChartConfig: jest.fn(),
}));

const mockUseQueriedChartConfig = useQueriedChartConfig as jest.Mock;

describe('DBRowDataPanel', () => {
  const source: TLogSource = {
    id: 'source-id',
    kind: SourceKind.Log,
    name: 'logs',
    connection: 'conn-id',
    from: { databaseName: 'default', tableName: 'logs' },
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp, Body',
    bodyExpression: 'Body',
  };

  beforeEach(() => {
    jest.clearAllMocks();
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
    });
  });

  describe('getJSONColumnNames', () => {
    it('should return JSON column names', () => {
      const meta = [
        { name: 'col1', type: 'String' },
        { name: 'col2', type: 'JSON' },
        { name: 'col3', type: 'JSON(1)' },
      ];
      const result = getJSONColumnNames(meta);
      expect(result).toEqual(['col2', 'col3']);
    });
  });

  it('selects `*` when the source has no Known Columns List', () => {
    renderHook(() => useRowData({ source, rowId: "id='abc123'" }));

    const [config] = mockUseQueriedChartConfig.mock.calls[0];
    expect(config.select[0]).toEqual({ valueExpression: '*' });
  });

  it('selects the Known Columns List instead of `*` when set', () => {
    const sourceWithKnownColumns: TLogSource = {
      ...source,
      knownColumnsListExpression: 'Timestamp, Body, ServiceName',
    };

    renderHook(() =>
      useRowData({ source: sourceWithKnownColumns, rowId: "id='abc123'" }),
    );

    const [config] = mockUseQueriedChartConfig.mock.calls[0];
    expect(config.select[0]).toEqual({
      valueExpression: 'Timestamp, Body, ServiceName',
    });
    expect(config.select).not.toContainEqual({ valueExpression: '*' });
  });

  // Regression test for the OSS #2357 conflict-resolution merge. The
  // composed result wraps `Event Attributes` in a length check from
  // origin/main AND passes `mapColumns={mapColumns}` through to the
  // DBRowJsonViewer from HEAD. Both branches are wired through
  // `getMapColumnNames`, which is the symbol the resolution
  // introduces from HEAD and that origin/main otherwise lacks. A
  // regression in either compose direction would either drop the
  // helper or change its semantics; this test pins both.
  describe('getMapColumnNames', () => {
    it('returns Map column names', () => {
      const meta = [
        { name: 'col1', type: 'String' },
        { name: 'LogAttributes', type: 'Map(String, String)' },
        { name: 'ResourceAttributes', type: 'Map(String, String)' },
        { name: 'col4', type: 'JSON' },
      ];
      expect(getMapColumnNames(meta)).toEqual([
        'LogAttributes',
        'ResourceAttributes',
      ]);
    });

    it('matches the bare Map type as well as Map(K, V)', () => {
      const meta = [
        { name: 'bareMap', type: 'Map' },
        { name: 'typedMap', type: 'Map(String, UInt8)' },
        { name: 'notMap', type: 'String' },
      ];
      expect(getMapColumnNames(meta)).toEqual(['bareMap', 'typedMap']);
    });

    it('returns an empty array when meta is undefined', () => {
      expect(getMapColumnNames(undefined)).toEqual([]);
    });

    it('does not classify JSON columns as Map columns', () => {
      const meta = [{ name: 'BodyJson', type: 'JSON' }];
      expect(getMapColumnNames(meta)).toEqual([]);
    });
  });
});
