import { SourceKind } from '@hyperdx/common-utils/dist/types';

import { ISource, Source } from '@/models/source';

/**
 * Clean up metricTables property when changing source type away from Metric.
 * This prevents metric-specific configuration from persisting when switching
 * to Log, Trace, or Session sources.
 */
function cleanSourceData(source: Omit<ISource, 'id'>): Omit<ISource, 'id'> {
  // Only clean metricTables if the source is not a Metric type
  if (source.kind !== SourceKind.Metric) {
    // explicitly setting to null for mongoose to clear column
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
    source.metricTables = null as any;
  }

  return source;
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
