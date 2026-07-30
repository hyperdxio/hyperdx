import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

import {
  buildInFilterCondition,
  getEffectiveTraceSourceId,
} from '@/ServicesDashboardPage';

describe('buildInFilterCondition', () => {
  it.each([
    {
      columnExpression: 'ServiceName',
      value: 'checkout-service',
      expected: "ServiceName IN ('checkout-service')",
    },
    {
      columnExpression: "SpanAttributes['service.name']",
      value: "O'Reilly API",
      expected: "SpanAttributes['service.name'] IN ('O\\'Reilly API')",
    },
    {
      columnExpression: "ResourceAttributes['service.namespace']",
      value: 'payments "v2"',
      expected:
        "ResourceAttributes['service.namespace'] IN ('payments \\\"v2\\\"')",
    },
  ])(
    'escapes value and keeps column expression for $columnExpression',
    ({ columnExpression, value, expected }) => {
      expect(buildInFilterCondition(columnExpression, value)).toBe(expected);
    },
  );
});

describe('getEffectiveTraceSourceId', () => {
  // Only the fields the helper reads; cast because TSource requires much more.
  const sources = [
    { id: 'log-1', name: 'Logs', kind: SourceKind.Log },
    {
      id: 'trace-disabled',
      name: 'Old Traces',
      kind: SourceKind.Trace,
      disabled: true,
    },
    { id: 'trace-1', name: 'Traces', kind: SourceKind.Trace },
    { id: 'trace-2', name: 'More Traces', kind: SourceKind.Trace },
  ] as TSource[];

  it('keeps an enabled trace source', () => {
    expect(getEffectiveTraceSourceId('trace-2', sources)).toBe('trace-2');
  });

  it('falls back to the first enabled trace source for a non-trace source', () => {
    expect(getEffectiveTraceSourceId('log-1', sources)).toBe('trace-1');
  });

  it('falls back for a disabled trace source', () => {
    expect(getEffectiveTraceSourceId('trace-disabled', sources)).toBe(
      'trace-1',
    );
  });

  it('falls back when the param resolved to nothing', () => {
    // undefined is what the resolver yields for an unknown name, a wrong-kind
    // source, or a still-loading source list.
    expect(getEffectiveTraceSourceId(undefined, sources)).toBe('trace-1');
    expect(getEffectiveTraceSourceId(null, sources)).toBe('trace-1');
  });

  it('returns an empty string when there is no usable trace source', () => {
    expect(getEffectiveTraceSourceId('trace-1', undefined)).toBe('');
    expect(getEffectiveTraceSourceId('trace-1', [])).toBe('');
    expect(getEffectiveTraceSourceId('trace-1', [sources[0], sources[1]])).toBe(
      '',
    );
  });
});
