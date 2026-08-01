import { SourceKind, TSource } from '@hyperdx/common-utils/dist/types';

export type CorrelationField =
  | 'logSourceId'
  | 'traceSourceId'
  | 'sessionSourceId'
  | 'metricSourceId';

export function getCorrelationFieldValue(
  source: TSource,
  field: CorrelationField,
): string | undefined {
  switch (field) {
    case 'logSourceId':
      if (source.kind === SourceKind.Trace)
        return source.logSourceId ?? undefined;
      if (source.kind === SourceKind.Metric)
        return source.logSourceId ?? undefined;
      return undefined;
    case 'traceSourceId':
      if (source.kind === SourceKind.Log)
        return source.traceSourceId ?? undefined;
      if (source.kind === SourceKind.Session) return source.traceSourceId;
      return undefined;
    case 'sessionSourceId':
      if (source.kind === SourceKind.Trace)
        return source.sessionSourceId ?? undefined;
      return undefined;
    case 'metricSourceId':
      if (source.kind === SourceKind.Log)
        return source.metricSourceId ?? undefined;
      if (source.kind === SourceKind.Trace)
        return source.metricSourceId ?? undefined;
      return undefined;
  }
}

export function setCorrelationFieldValue(
  source: TSource,
  field: CorrelationField,
  value: string | undefined,
): TSource {
  switch (source.kind) {
    case SourceKind.Log:
      if (field === 'traceSourceId' || field === 'metricSourceId') {
        return { ...source, [field]: value };
      }
      return source;
    case SourceKind.Trace:
      if (
        field === 'logSourceId' ||
        field === 'sessionSourceId' ||
        field === 'metricSourceId'
      ) {
        return { ...source, [field]: value };
      }
      return source;
    case SourceKind.Session:
      if (field === 'traceSourceId') {
        return { ...source, traceSourceId: value ?? '' };
      }
      return source;
    case SourceKind.Metric:
      if (field === 'logSourceId') {
        return { ...source, [field]: value };
      }
      return source;
    case SourceKind.Promql:
      return source;
  }
}

export const CORRELATION_FIELD_MAP: Record<
  SourceKind,
  Partial<
    Record<
      CorrelationField,
      { targetKind: SourceKind; targetField: CorrelationField }[]
    >
  >
> = {
  [SourceKind.Log]: {
    metricSourceId: [
      { targetKind: SourceKind.Metric, targetField: 'logSourceId' },
    ],
    traceSourceId: [
      { targetKind: SourceKind.Trace, targetField: 'logSourceId' },
    ],
  },
  [SourceKind.Trace]: {
    logSourceId: [{ targetKind: SourceKind.Log, targetField: 'traceSourceId' }],
    sessionSourceId: [
      { targetKind: SourceKind.Session, targetField: 'traceSourceId' },
    ],
    metricSourceId: [
      { targetKind: SourceKind.Metric, targetField: 'logSourceId' },
    ],
  },
  [SourceKind.Session]: {
    traceSourceId: [
      { targetKind: SourceKind.Trace, targetField: 'sessionSourceId' },
    ],
  },
  [SourceKind.Metric]: {
    logSourceId: [
      { targetKind: SourceKind.Log, targetField: 'metricSourceId' },
    ],
  },
  [SourceKind.Promql]: {},
};
