import type { TTraceSource } from '@hyperdx/common-utils/dist/types';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import {
  getExpressions,
  makeCoalescedFieldsAccessQuery,
} from '../serviceDashboard';

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
    durationExpression: 'Duration',
    durationPrecision: 9,
    traceIdExpression: 'TraceId',
    serviceNameExpression: 'ServiceName',
    spanNameExpression: 'SpanName',
    spanKindExpression: 'SpanKind',
    statusCodeExpression: 'StatusCode',
    spanIdExpression: 'SpanId',
    parentSpanIdExpression: 'ParentSpanId',
  };

  describe('getExpressions', () => {
    it('should use map syntax for non-JSON columns by default', () => {
      const expressions = getExpressions(mockSource, []);

      expect(expressions.k8sResourceName).toBe(
        "SpanAttributes['k8s.resource.name']",
      );
      expect(expressions.k8sPodName).toBe("SpanAttributes['k8s.pod.name']");
      expect(expressions.httpScheme).toBe("SpanAttributes['http.scheme']");
      expect(expressions.serverAddress).toBe(
        "SpanAttributes['server.address']",
      );
      expect(expressions.httpHost).toBe("SpanAttributes['http.host']");
      expect(expressions.dbStatement).toBe(
        "coalesce(nullif(SpanAttributes['db.query.text'], ''), nullif(SpanAttributes['db.statement'], ''))",
      );
    });

    it('should use backtick syntax when SpanAttributes is a JSON column', () => {
      const expressions = getExpressions(mockSource, ['SpanAttributes']);

      expect(expressions.k8sResourceName).toBe(
        'SpanAttributes.`k8s.resource.name`',
      );
      expect(expressions.k8sPodName).toBe('SpanAttributes.`k8s.pod.name`');
      expect(expressions.httpScheme).toBe('SpanAttributes.`http.scheme`');
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
      const expressions = getExpressions(mockSource);

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
      }).toThrowError(
        'Empty fields array passed while trying to build a coalesced field access query',
      );
    });

    it('should throw an error if more than 100 fields are passed', () => {
      expect(() => {
        makeCoalescedFieldsAccessQuery(Array(101).fill('field'), false);
      }).toThrowError(
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
});
