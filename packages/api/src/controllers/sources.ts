import { SourceKind } from '@/../../common-utils/dist/types';
import {
  ISource,
  LogSource,
  MetricSource,
  SessionSource,
  Source,
  TraceSource,
} from '@/models/source';

export function getSources(team: string) {
  return Source.find({ team });
}

export function getSource(team: string, sourceId: string) {
  return Source.findOne({ _id: sourceId, team });
}

export function createSource(team: string, source: Omit<ISource, 'id'>) {
  switch (source.kind) {
    case SourceKind.Log:
      return LogSource.create({ ...source, team });
    case SourceKind.Trace:
      return TraceSource.create({ ...source, team });
    case SourceKind.Metric:
      return MetricSource.create({ ...source, team });
    case SourceKind.Session:
      return SessionSource.create({ ...source, team });
  }
}

export function updateSource(
  team: string,
  sourceId: string,
  source: Omit<ISource, 'id'>,
) {
  switch (source.kind) {
    case SourceKind.Log:
      return LogSource.findOneAndUpdate({ _id: sourceId, team }, source, {
        new: true,
      });
    case SourceKind.Trace:
      return TraceSource.findOneAndUpdate({ _id: sourceId, team }, source, {
        new: true,
      });
    case SourceKind.Metric:
      return MetricSource.findOneAndUpdate({ _id: sourceId, team }, source, {
        new: true,
      });
    case SourceKind.Session:
      return SessionSource.findOneAndUpdate({ _id: sourceId, team }, source, {
        new: true,
      });
  }
}

export function deleteSource(team: string, sourceId: string) {
  return Source.findOneAndDelete({ _id: sourceId, team });
}
