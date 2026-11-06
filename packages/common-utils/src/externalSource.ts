import { SourceKind, SourceSchema, type TSource } from '@/types';

export function mapGranularityToExternalFormat(granularity: string): string {
  const matches = granularity.match(/^(\d+) (second|minute|hour|day)$/);
  if (matches == null) return granularity;

  const [, amount, unit] = matches;
  switch (unit) {
    case 'second':
      return `${amount}s`;
    case 'minute':
      return `${amount}m`;
    case 'hour':
      return `${amount}h`;
    case 'day':
      return `${amount}d`;
    default:
      return granularity;
  }
}

export function mapGranularityToInternalFormat(granularity: string): string {
  const matches = granularity.match(/^(\d+)(s|m|h|d)$/);
  if (matches == null) return granularity;

  const [, amount, unit] = matches;
  switch (unit) {
    case 's':
      return `${amount} second`;
    case 'm':
      return `${amount} minute`;
    case 'h':
      return `${amount} hour`;
    case 'd':
      return `${amount} day`;
    default:
      return granularity;
  }
}

function mapGranularitiesToExternalFormat(source: TSource): TSource {
  if (!('materializedViews' in source)) return source;

  const mapped = { ...source };

  if (Array.isArray(source.materializedViews)) {
    mapped.materializedViews = source.materializedViews.map(view => ({
      ...view,
      minGranularity: mapGranularityToExternalFormat(view.minGranularity),
    }));
  }

  if (
    'metadataMaterializedViews' in source &&
    source.metadataMaterializedViews
  ) {
    mapped.metadataMaterializedViews = {
      ...source.metadataMaterializedViews,
      granularity: mapGranularityToExternalFormat(
        source.metadataMaterializedViews.granularity,
      ),
    };
  }

  return mapped;
}

function applyLegacyDefaults(parsed: unknown): unknown {
  // Legacy Session sources were created before timestampValueExpression was
  // required. The old code defaulted it to 'TimestampTime' at query time.
  if (
    parsed != null &&
    typeof parsed === 'object' &&
    'kind' in parsed &&
    parsed.kind === SourceKind.Session &&
    !('timestampValueExpression' in parsed && parsed.timestampValueExpression)
  ) {
    return { ...parsed, timestampValueExpression: 'TimestampTime' };
  }
  return parsed;
}

/**
 * A source in the shape the external API (`/api/v2/sources`) returns: only
 * SourceSchema fields, with short-form granularities ("5m"). `json` must be
 * plain JSON (ids as strings).
 */
export function toExternalSource(json: unknown) {
  const result = SourceSchema.safeParse(applyLegacyDefaults(json));
  return result.success
    ? {
        success: true as const,
        data: mapGranularitiesToExternalFormat(result.data),
      }
    : { success: false as const, error: result.error };
}
