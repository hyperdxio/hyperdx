import { SourceKind, SourceSchema } from '@hyperdx/common-utils/dist/types';

import {
  ISourceInput,
  LogSource,
  MetricSource,
  SessionSource,
  Source,
  TraceSource,
} from '@/models/source';

// Returns the discriminator model for the given source kind.
// Updates must go through the correct discriminator model so Mongoose
// recognises kind-specific fields (e.g. metricTables on MetricSource).
function getModelForKind(kind: SourceKind) {
  switch (kind) {
    case SourceKind.Log:
      return LogSource;
    case SourceKind.Trace:
      return TraceSource;
    case SourceKind.Session:
      return SessionSource;
    case SourceKind.Metric:
      return MetricSource;
    default:
      kind satisfies never;
      throw new Error(`${kind} is not a valid SourceKind`);
  }
}

export function getSources(team: string) {
  return Source.find({ team });
}

export function getSource(team: string, sourceId: string) {
  return Source.findOne({ _id: sourceId, team });
}

type DistributiveOmit<T, K extends PropertyKey> = T extends T
  ? Omit<T, K>
  : never;

export function createSource(
  team: string,
  source: DistributiveOmit<ISourceInput, 'id'>,
) {
  // @ts-expect-error The create method has incompatible type signatures but is actually safe
  return getModelForKind(source.kind)?.create({ ...source, team });
}

export async function updateSource(
  team: string,
  sourceId: string,
  source: DistributiveOmit<ISourceInput, 'id'>,
) {
  const existing = await Source.findOne({ _id: sourceId, team });
  if (!existing) return null;

  // Same kind: simple update through the discriminator model
  if (existing.kind === source.kind) {
    // @ts-expect-error The findOneAndUpdate method has incompatible type signatures but is actually safe
    return getModelForKind(source.kind)?.findOneAndUpdate(
      { _id: sourceId, team },
      source,
      { new: true },
    );
  }

  // Kind changed: validate through Zod before writing since the raw
  // collection bypass skips Mongoose's discriminator validation.
  const parseResult = SourceSchema.safeParse(source);
  if (!parseResult.success) {
    throw new Error(
      `Invalid source data: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
    );
  }

  // Use replaceOne on the raw collection to swap the entire document
  // in place (including the discriminator key). This is a single atomic
  // write — the document is never absent from the collection.
  const replacement = {
    ...parseResult.data,
    _id: existing._id,
    team: existing.team,
    updatedAt: new Date(),
  };
  await Source.collection.replaceOne({ _id: existing._id }, replacement);
  return getModelForKind(replacement.kind)?.hydrate(replacement);
}

export function deleteSource(team: string, sourceId: string) {
  return Source.findOneAndDelete({ _id: sourceId, team });
}
