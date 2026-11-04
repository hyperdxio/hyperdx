import { isTraceSource, TraceScopeResolution, TSource } from '@/types';

export function resolveTraceScope(source: TSource): TraceScopeResolution {
  if (!isTraceSource(source)) {
    return { applicable: false, reason: 'non-trace-source' };
  }
  const expr = source.traceIdExpression?.trim();
  if (!expr) {
    return { applicable: false, reason: 'missing-trace-id-expression' };
  }
  return { applicable: true, traceIdExpression: expr };
}
