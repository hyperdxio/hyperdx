import { SourceKind, SourceSchemaNoId } from '@hyperdx/common-utils/dist/types';
import mongoose from 'mongoose';

import {
  ISourceInput,
  LogSource,
  MetricSource,
  PromqlSource,
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
    case SourceKind.Promql:
      return PromqlSource;
    default:
      kind satisfies never;
      throw new Error(`${kind} is not a valid SourceKind`);
  }
}

export function getSources(team: string) {
  return Source.find({ team });
}

export async function getSource(team: string, sourceId: string) {
  // Pre-check the sourceId shape so a non-ObjectId input returns null
  // (the caller's "not found" branch) instead of bubbling a Mongoose
  // CastError.
  if (!mongoose.Types.ObjectId.isValid(sourceId)) {
    return null;
  }
  try {
    return await Source.findOne({ _id: sourceId, team });
  } catch {
    // Defense-in-depth: if Mongoose still throws (e.g. a future cast
    // path), treat it as "not found" so the caller can surface a clean
    // error.
    return null;
  }
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

  // Mongoose sets createdAt to now on replace unless the replacement
  // document already carries one — preserve the original in both paths.
  const createdAt: Date | undefined = existing.get('createdAt');

  // findOneAndReplace swaps the whole document, so `team` must be in the
  // replacement or the source is dropped from every team-scoped query.
  if (existing.kind === source.kind) {
    // @ts-expect-error The findOneAndReplace method has incompatible type signatures but is actually safe
    return getModelForKind(source.kind)?.findOneAndReplace(
      { _id: sourceId, team },
      { ...source, team, ...(createdAt && { createdAt }) },
      { new: true },
    );
  }

  // Kind changed: validate through Zod before writing since the raw
  // collection bypass skips Mongoose's discriminator validation. Uses the
  // no-id schema because callers identify the source via sourceId — any id
  // in the body is ignored (and _id is preserved from the existing doc).
  const parseResult = SourceSchemaNoId.safeParse(source);
  if (!parseResult.success) {
    throw new Error(
      `Invalid source data: ${parseResult.error.errors.map(e => e.message).join(', ')}`,
    );
  }

  // The raw write below bypasses Mongoose casting, so validate and cast
  // connection explicitly — otherwise a garbage string is persisted verbatim
  // and the stored BSON type diverges from documents written via Mongoose.
  if (!mongoose.Types.ObjectId.isValid(parseResult.data.connection)) {
    throw new Error('Invalid source data: connection must be a valid id');
  }

  // Use replaceOne on the raw collection to swap the entire document
  // in place (including the discriminator key). This is a single atomic
  // write — the document is never absent from the collection.
  const replacement = {
    ...parseResult.data,
    connection: new mongoose.Types.ObjectId(parseResult.data.connection),
    _id: existing._id,
    team: existing.team,
    ...(createdAt && { createdAt }),
    updatedAt: new Date(),
  };
  const result = await Source.collection.replaceOne(
    { _id: existing._id, team: existing.team },
    replacement,
  );
  // Deleted concurrently between the findOne above and the replace: report
  // not-found instead of returning a hydrated document that no longer exists.
  if (result.matchedCount === 0) return null;
  return getModelForKind(replacement.kind)?.hydrate(replacement);
}

export function deleteSource(team: string, sourceId: string) {
  return Source.findOneAndDelete({ _id: sourceId, team });
}
