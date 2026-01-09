import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { ISource, Source } from '@/models/source';

// Metric-specific properties
const metricOnlyProps = ['metricTables'];

// Trace-specific properties
const traceOnlyProps = [
  'durationExpression',
  'durationPrecision',
  'parentSpanIdExpression',
  'spanNameExpression',
  'spanKindExpression',
  'statusCodeExpression',
  'statusMessageExpression',
  'spanEventsValueExpression',
  'sessionSourceId',
];

// Log-specific properties
const logOnlyProps = [
  'severityTextExpression',
  'bodyExpression',
  'uniqueRowIdExpression',
  'tableFilterExpression',
  'displayedTimestampValueExpression',
];

// Properties shared between ONLY Log and Trace
const logTraceSharedProps = [
  'defaultTableSelectExpression',
  'serviceNameExpression',
  'eventAttributesExpression',
  'implicitColumnExpression',
  'traceIdExpression', // Required in Trace, optional in Log for correlation
  'spanIdExpression', // Required in Trace, optional in Log for correlation
  'metricSourceId', // Both Log and Trace can correlate to metrics
  'highlightedTraceAttributeExpressions',
  'highlightedRowAttributeExpressions',
  'materializedViews',
];

// Helper to clean type-specific properties that don't match the source kind
function cleanSourceData(source: Omit<ISource, 'id'>): Omit<ISource, 'id'> {
  const sourceClone: Omit<ISource, 'id'> = { ...source };

  // Determine which properties to clean based on the new source kind
  let propertiesToClean: string[] = [];
  switch (source.kind) {
    case SourceKind.Log:
      propertiesToClean = [...metricOnlyProps, ...traceOnlyProps];
      break;
    case SourceKind.Trace:
      propertiesToClean = [...metricOnlyProps, ...logOnlyProps];
      break;
    case SourceKind.Metric:
      propertiesToClean = [
        ...logOnlyProps,
        ...traceOnlyProps,
        ...logTraceSharedProps,
      ];
      break;
    case SourceKind.Session:
      propertiesToClean = [
        ...metricOnlyProps,
        ...traceOnlyProps,
        ...logOnlyProps,
        ...logTraceSharedProps,
      ];
      break;
  }

  // Set properties to null so MongoDB removes them
  propertiesToClean.forEach(prop => {
    // The array of keys is static and validated, so this is safe
    // eslint-disable-next-line security/detect-object-injection
    (sourceClone as any)[prop] = null;
  });

  return sourceClone;
}

export function getSources(team: string) {
  return Source.find({ team });
}

export function getSource(team: string, sourceId: string) {
  return Source.findOne({ _id: sourceId, team });
}

export function createSource(team: string, source: Omit<ISource, 'id'>) {
  return Source.create({ ...source, team });
}

export function updateSource(
  team: string,
  sourceId: string,
  source: Omit<ISource, 'id'>,
) {
  const cleanedSource = cleanSourceData(source);
  return Source.findOneAndUpdate({ _id: sourceId, team }, cleanedSource, {
    new: true,
  });
}

export function deleteSource(team: string, sourceId: string) {
  return Source.findOneAndDelete({ _id: sourceId, team });
}
