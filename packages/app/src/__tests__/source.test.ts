import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import { getEventBody } from '../source';

describe('getEventBody', () => {
  // Added to prevent regression back to HDX-3361
  it('returns spanNameExpression for trace kind source when both bodyExpression and spanNameExpression are present', () => {
    const source: TSource = {
      kind: SourceKind.Trace,
      from: {
        databaseName: 'default',
        tableName: 'otel_traces',
      },
      timestampValueExpression: 'Timestamp',
      connection: 'test-connection',
      name: 'Traces',
      id: 'test-source-id',
      bodyExpression: 'Body',
      spanNameExpression: 'SpanName',
    };

    const result = getEventBody(source);

    expect(result).toBe('SpanName');
  });
});
