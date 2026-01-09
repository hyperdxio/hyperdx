import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { ISource, Source } from '@/models/source';

const metricSpecificProps = ['metricTables'];
const traceSpecificProps = [
  'durationExpression',
  'durationPrecision',
  'parentSpanIdExpression',
  'spanNameExpression',
  'spanKindExpression',
  'statusCodeExpression',
  'statusMessageExpression',
  'spanEventsValueExpression',
];
const logSpecificProps = ['severityTextExpression', 'bodyExpression'];

// Helper to clean type-specific properties that don't match the source kind
function cleanSourceData(source: Omit<ISource, 'id'>): Omit<ISource, 'id'> {
  const sourceClone: Omit<ISource, 'id'> = { ...source };

  // Determine which properties to clean based on source kind
  let propertiesToClean: string[] = [];
  switch (source.kind) {
    case SourceKind.Log:
      // Remove metric and trace specific properties
      propertiesToClean = [...metricSpecificProps, ...traceSpecificProps];
      break;
    case SourceKind.Trace:
      // Remove metric and log specific properties
      propertiesToClean = [...metricSpecificProps, ...logSpecificProps];
      break;
    case SourceKind.Metric:
      // Remove trace and log specific properties
      propertiesToClean = [...traceSpecificProps, ...logSpecificProps];
      break;
    case SourceKind.Session:
      // Remove all type-specific properties (sessions only need base fields)
      propertiesToClean = [
        ...metricSpecificProps,
        ...traceSpecificProps,
        ...logSpecificProps,
      ];
      break;
  }

  // Set properties to null so MongoDB removes them
  propertiesToClean.forEach(prop => {
    // The array of keys is static, so we can safely use object injection
    // eslint-disable-next-line security/detect-object-injection
    sourceClone[prop] = null;
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
