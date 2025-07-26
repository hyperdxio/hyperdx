import type { TSource } from '@hyperdx/common-utils/dist/types';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { getExpressions } from '../serviceDashboard';

describe('Service Dashboard', () => {
  const mockSource: TSource = {
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
    severityTextExpression: 'StatusCode',
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
      expect(expressions.dbStatement).toBe(
        "coalesce(nullif(SpanAttributes.`db.query.text`, ''), nullif(SpanAttributes.`db.statement`, ''))",
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
});
