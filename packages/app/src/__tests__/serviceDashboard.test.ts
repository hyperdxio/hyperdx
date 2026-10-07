import type { ColumnMeta } from '@hyperdx/common-utils/dist/clickhouse';
import { parseQuery } from '@hyperdx/common-utils/dist/filters';
import type { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { SourceKind } from '@hyperdx/common-utils/dist/types';
import { renderHook } from '@testing-library/react';

import * as metadataModule from '@/hooks/useMetadata';
import {
  getExpressions,
  makeCoalescedFieldsAccessQuery,
  makeDbStatementCondition,
  useServiceDashboardExpressions,
} from '@/serviceDashboard';

function removeAllWhitespace(str: string) {
  return str.replace(/\s|\t|\n/g, '');
}

describe('Service Dashboard', () => {
  const mockSource: TTraceSource = {
    id: 'test-source',
    name: 'Test Source',
    kind: SourceKind.Trace,
    from: {
      databaseName: 'test_db',
      tableName: 'otel_traces_json',
    },
    connection: 'test-connection',
    timestampValueExpression: 'Timestamp',
    defaultTableSelectExpression: 'Timestamp',
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
    serviceNameExpression: 'ServiceName',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    statusCodeExpression: 'StatusCode',
  };

  describe('getExpressions', () => {
    it('should use map syntax for non-JSON columns by default', () => {
      const expressions = getExpressions(mockSource, [], []);

      expect(expressions.k8sResourceName).toBe(
        "SpanAttributes['k8s.resource.name']",
      );
      expect(expressions.k8sPodName).toBe("SpanAttributes['k8s.pod.name']");
      expect(expressions.serverAddress).toBe(
        "SpanAttributes['server.address']",
      );
      expect(expressions.httpHost).toBe("SpanAttributes['http.host']");
      expect(expressions.dbStatement).toBe(
        "coalesce(nullif(SpanAttributes['db.query.text'], ''), nullif(SpanAttributes['db.statement'], ''))",
      );
    });

    it('should use backtick syntax when SpanAttributes is a JSON column', () => {
      const expressions = getExpressions(mockSource, [], ['SpanAttributes']);

      expect(expressions.k8sResourceName).toBe(
        'SpanAttributes.`k8s.resource.name`',
      );
      expect(expressions.k8sPodName).toBe('SpanAttributes.`k8s.pod.name`');
      expect(expressions.serverAddress).toBe('SpanAttributes.`server.address`');
      expect(expressions.httpHost).toBe('SpanAttributes.`http.host`');
      const resultWithWhitespaceStripped = removeAllWhitespace(
        expressions.dbStatement,
      );
      expect(resultWithWhitespaceStripped).toEqual(
        `coalesce(if(toString(SpanAttributes.\`db.query.text\`)!='',toString(SpanAttributes.\`db.query.text\`),if(toString(SpanAttributes.\`db.statement\`)!='',toString(SpanAttributes.\`db.statement\`),'')))`,
      );
    });

    it('should work with empty jsonColumns array', () => {
      const expressions = getExpressions(mockSource, [], []);

      // Should default to map syntax
      expect(expressions.k8sResourceName).toBe(
        "SpanAttributes['k8s.resource.name']",
      );
    });
  });

  describe('makeCoalescedFieldsAccessQuery', () => {
    it('should throw an error if an empty list of fields is passed', () => {
      expect(() => {
        makeCoalescedFieldsAccessQuery([], false);
      }).toThrow(
        'Empty fields array passed while trying to build a coalesced field access query',
      );
    });

    it('should throw an error if more than 100 fields are passed', () => {
      expect(() => {
        makeCoalescedFieldsAccessQuery(Array(101).fill('field'), false);
      }).toThrow(
        'Too many fields (101) passed while trying to build a coalesced field access query. Maximum allowed is 100',
      );
    });

    it('should handle single field for non-JSON columns', () => {
      const result = makeCoalescedFieldsAccessQuery(['field1'], false);
      expect(result).toBe("nullif(field1, '')");
    });

    it('should handle single field for JSON columns', () => {
      const result = makeCoalescedFieldsAccessQuery(['field1'], true);
      expect(result).toBe("if(toString(field1) != '', toString(field1), '')");
    });

    it('should handle multiple fields for non-JSON columns', () => {
      const result = makeCoalescedFieldsAccessQuery(
        ['field1', 'field2'],
        false,
      );
      expect(result).toBe("coalesce(nullif(field1, ''), nullif(field2, ''))");
    });

    it('should handle multiple fields for JSON columns', () => {
      const result = makeCoalescedFieldsAccessQuery(['field1', 'field2'], true);
      const resultWithWhitespaceStripped = removeAllWhitespace(result);
      expect(resultWithWhitespaceStripped).toEqual(
        `coalesce(if(toString(field1)!='',toString(field1),if(toString(field2)!='',toString(field2),'')))`,
      );
    });

    it('should handle three fields for JSON columns', () => {
      const result = makeCoalescedFieldsAccessQuery(
        ['field1', 'field2', 'field3'],
        true,
      );
      const resultWithWhitespaceStripped = removeAllWhitespace(result);
      expect(resultWithWhitespaceStripped).toEqual(
        `coalesce(if(toString(field1)!='',toString(field1),if(toString(field2)!='',toString(field2),if(toString(field3)!='',toString(field3),''))))`,
      );
    });

    it('should handle three fields for non-JSON columns', () => {
      const result = makeCoalescedFieldsAccessQuery(
        ['field1', 'field2', 'field3'],
        false,
      );
      expect(result).toBe(
        "coalesce(nullif(field1, ''), nullif(field2, ''), nullif(field3, ''))",
      );
    });
  });

  describe('dbStatementIndexHint', () => {
    const attributesColumn = {
      name: 'SpanAttributes',
      type: 'Map(LowCardinality(String), String)',
    } as ColumnMeta;
    const itemsColumn = { name: 'SpanAttributeItems' } as ColumnMeta;

    it('should prefer the attribute items column when the table has one', () => {
      expect(
        getExpressions(mockSource, [attributesColumn, itemsColumn], [])
          .dbStatementIndexHint,
      ).toEqual({ kind: 'items', column: 'SpanAttributeItems' });
    });

    it('should fall back to the attribute map, which older schemas index by value', () => {
      expect(
        getExpressions(mockSource, [attributesColumn], []).dbStatementIndexHint,
      ).toEqual({ kind: 'mapValues', column: 'SpanAttributes' });
    });

    it('should be undefined when the attribute field is not a map', () => {
      expect(
        getExpressions(
          mockSource,
          [{ name: 'SpanAttributes', type: 'String' } as ColumnMeta],
          [],
        ).dbStatementIndexHint,
      ).toBeUndefined();
    });

    it('should be undefined for JSON attribute columns', () => {
      expect(
        getExpressions(
          mockSource,
          [attributesColumn, itemsColumn],
          ['SpanAttributes'],
        ).dbStatementIndexHint,
      ).toBeUndefined();
    });

    it('should not mistake the attribute field itself for an items column', () => {
      expect(
        getExpressions(
          { ...mockSource, eventAttributesExpression: 'Attrs' },
          [{ name: 'Attrs', type: 'Map(String, String)' } as ColumnMeta],
          [],
        ).dbStatementIndexHint,
      ).toEqual({ kind: 'mapValues', column: 'Attrs' });
    });
  });

  describe('makeDbStatementCondition', () => {
    const dbStatement =
      "coalesce(nullif(SpanAttributes['db.query.text'], ''), nullif(SpanAttributes['db.statement'], ''))";
    const equality = `${dbStatement} IN ('SELECT 1')`;

    it('should only compare the statement when nothing is indexed', () => {
      expect(
        makeDbStatementCondition({
          expressions: { dbStatement, dbStatementIndexHint: undefined },
          statement: 'SELECT 1',
        }),
      ).toBe(equality);
    });

    it('should prefilter on the items column, which newer schemas index', () => {
      expect(
        makeDbStatementCondition({
          expressions: {
            dbStatement,
            dbStatementIndexHint: {
              kind: 'items',
              column: 'SpanAttributeItems',
            },
          },
          statement: 'SELECT 1',
        }),
      ).toBe(
        "(has(SpanAttributeItems, 'db.query.text=SELECT 1') OR " +
          "has(SpanAttributeItems, 'db.statement=SELECT 1')) " +
          `AND ${equality}`,
      );
    });

    it('should prefilter on the attribute values, which older schemas index', () => {
      expect(
        makeDbStatementCondition({
          expressions: {
            dbStatement,
            dbStatementIndexHint: {
              kind: 'mapValues',
              column: 'SpanAttributes',
            },
          },
          statement: 'SELECT 1',
        }),
      ).toBe(
        `(has(mapValues(SpanAttributes), 'SELECT 1')) AND ${equality}`,
      );
    });

    it.each([
      ['items' as const, 'SpanAttributeItems'],
      ['mapValues' as const, 'SpanAttributes'],
    ])('should escape quotes in the %s prefilter', (kind, column) => {
      const condition = makeDbStatementCondition({
        expressions: { dbStatement, dbStatementIndexHint: { kind, column } },
        statement: "SELECT 'a'",
      });

      expect(condition).toContain("SELECT ''a''");
      expect(condition).not.toContain("SELECT 'a'");
    });

    it.each([
      [undefined],
      [{ kind: 'items' as const, column: 'SpanAttributeItems' }],
      [{ kind: 'mapValues' as const, column: 'SpanAttributes' }],
    ])(
      'should be read back by the search page as the same filter (%p)',
      dbStatementIndexHint => {
        const statement = "SELECT 'a' FROM t WHERE b IN (1) AND c = ?";

        const { filters } = parseQuery([
          {
            type: 'sql',
            condition: makeDbStatementCondition({
              expressions: { dbStatement, dbStatementIndexHint },
              statement,
            }),
          },
        ]);

        expect(Object.keys(filters)).toEqual([dbStatement]);
        expect([...filters[dbStatement].included]).toEqual([statement]);
      },
    );
  });

  describe('useServiceDashboardExpressions', () => {
    const mockColumns: ColumnMeta[] = [
      { name: 'Duration', type: 'UInt64' },
      { name: 'TraceId', type: 'String' },
      { name: 'ServiceName', type: 'String' },
      { name: 'SpanName', type: 'String' },
      { name: 'SpanKind', type: 'String' },
      { name: 'StatusCode', type: 'String' },
      { name: 'SpanAttributes', type: 'Map(String, String)' },
    ] as ColumnMeta[];

    const mockJsonColumns: string[] = [];

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return loading state when source is undefined', () => {
      jest.spyOn(metadataModule, 'useJsonColumns').mockReturnValue({
        data: undefined,
        isLoading: false,
      } as any);
      jest.spyOn(metadataModule, 'useColumns').mockReturnValue({
        data: undefined,
        isLoading: false,
      } as any);

      const { result } = renderHook(() =>
        useServiceDashboardExpressions({ source: undefined }),
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.expressions).toBeUndefined();
    });

    it('should return loading state when columns are loading', () => {
      jest.spyOn(metadataModule, 'useJsonColumns').mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);
      jest.spyOn(metadataModule, 'useColumns').mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);

      const { result } = renderHook(() =>
        useServiceDashboardExpressions({ source: mockSource }),
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.expressions).toBeUndefined();
    });

    it('should return loading state when jsonColumns are loading', () => {
      jest.spyOn(metadataModule, 'useJsonColumns').mockReturnValue({
        data: undefined,
        isLoading: true,
      } as any);
      jest.spyOn(metadataModule, 'useColumns').mockReturnValue({
        data: mockColumns,
        isLoading: false,
      } as any);

      const { result } = renderHook(() =>
        useServiceDashboardExpressions({ source: mockSource }),
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.expressions).toBeUndefined();
    });

    it('should return expressions when data is loaded with non-JSON columns', () => {
      jest.spyOn(metadataModule, 'useJsonColumns').mockReturnValue({
        data: mockJsonColumns,
        isLoading: false,
      } as any);
      jest.spyOn(metadataModule, 'useColumns').mockReturnValue({
        data: mockColumns,
        isLoading: false,
      } as any);

      const { result } = renderHook(() =>
        useServiceDashboardExpressions({ source: mockSource }),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.expressions).toBeDefined();
      expect(result.current.expressions?.duration).toBe('Duration');
      expect(result.current.expressions?.service).toBe('ServiceName');
      expect(result.current.expressions?.spanName).toBe('SpanName');
      expect(result.current.expressions?.traceId).toBe('TraceId');
      expect(result.current.expressions?.k8sResourceName).toBe(
        "SpanAttributes['k8s.resource.name']",
      );
    });

    it('should return expressions when data is loaded with JSON columns', () => {
      jest.spyOn(metadataModule, 'useJsonColumns').mockReturnValue({
        data: ['SpanAttributes'],
        isLoading: false,
      } as any);
      jest.spyOn(metadataModule, 'useColumns').mockReturnValue({
        data: mockColumns,
        isLoading: false,
      } as any);

      const { result } = renderHook(() =>
        useServiceDashboardExpressions({ source: mockSource }),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.expressions).toBeDefined();
      expect(result.current.expressions?.k8sResourceName).toBe(
        'SpanAttributes.`k8s.resource.name`',
      );
    });

    it('should use materialized endpoint column when available', () => {
      const columnsWithEndpoint: ColumnMeta[] = [
        ...mockColumns,
        { name: 'endpoint', type: 'String' },
      ] as ColumnMeta[];

      jest.spyOn(metadataModule, 'useJsonColumns').mockReturnValue({
        data: mockJsonColumns,
        isLoading: false,
      } as any);
      jest.spyOn(metadataModule, 'useColumns').mockReturnValue({
        data: columnsWithEndpoint,
        isLoading: false,
      } as any);

      const { result } = renderHook(() =>
        useServiceDashboardExpressions({ source: mockSource }),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.expressions?.endpoint).toBe('endpoint');
    });

    it('should fallback to spanName when materialized endpoint column is not available', () => {
      jest.spyOn(metadataModule, 'useJsonColumns').mockReturnValue({
        data: mockJsonColumns,
        isLoading: false,
      } as any);
      jest.spyOn(metadataModule, 'useColumns').mockReturnValue({
        data: mockColumns,
        isLoading: false,
      } as any);

      const { result } = renderHook(() =>
        useServiceDashboardExpressions({ source: mockSource }),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.expressions?.endpoint).toBe('SpanName');
    });

    it('should include filter expressions', () => {
      jest.spyOn(metadataModule, 'useJsonColumns').mockReturnValue({
        data: mockJsonColumns,
        isLoading: false,
      } as any);
      jest.spyOn(metadataModule, 'useColumns').mockReturnValue({
        data: mockColumns,
        isLoading: false,
      } as any);

      const { result } = renderHook(() =>
        useServiceDashboardExpressions({ source: mockSource }),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.expressions?.isError).toBe(
        "lower(StatusCode) = 'error'",
      );
      expect(result.current.expressions?.isSpanKindServer).toContain(
        'SpanKind IN',
      );
      expect(result.current.expressions?.isEndpointNonEmpty).toContain(
        'NOT empty(',
      );
    });

    it('should include auxiliary expressions', () => {
      jest.spyOn(metadataModule, 'useJsonColumns').mockReturnValue({
        data: mockJsonColumns,
        isLoading: false,
      } as any);
      jest.spyOn(metadataModule, 'useColumns').mockReturnValue({
        data: mockColumns,
        isLoading: false,
      } as any);

      const { result } = renderHook(() =>
        useServiceDashboardExpressions({ source: mockSource }),
      );

      expect(result.current.isLoading).toBe(false);
      expect(result.current.expressions?.durationInMillis).toBe('Duration/1e6');
      expect(result.current.expressions?.durationDivisorForMillis).toBe('1e6');
    });
  });
});
