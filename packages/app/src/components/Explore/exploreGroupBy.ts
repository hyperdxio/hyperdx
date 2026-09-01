import { splitAndTrimWithBracket } from '@hyperdx/common-utils/dist/core/utils';
import { SourceKind } from '@hyperdx/common-utils/dist/types';

/** The parts of a source that decide a default grouping. `TSource` satisfies it. */
export type GroupBySource = {
  kind?: SourceKind;
  severityTextExpression?: string;
  statusCodeExpression?: string;
  serviceNameExpression?: string;
};

/**
 * What a view splits on when the reader has not said. Logs and traces both have
 * a dimension worth breaking down by, and the events histogram has always used
 * it, so this doubles as the group-by placeholder: it names the grouping the
 * reader is already looking at rather than inventing a hint.
 */
export function defaultExploreGroupBy(
  source?: GroupBySource,
): string | undefined {
  switch (source?.kind) {
    case SourceKind.Log:
      return source.severityTextExpression;
    case SourceKind.Trace:
      return source.statusCodeExpression ?? source.serviceNameExpression;
    default:
      return undefined;
  }
}

/**
 * The reader's grouping wins wherever it is set, and clearing it hands the view
 * back to the source default. One rule for the events histogram and the chart
 * alike — they are the same dimension, which is why switching between them
 * keeps the breakdown.
 */
export function resolveExploreGroupBy(
  groupBy: string,
  source?: GroupBySource,
): string | undefined {
  return groupBy.trim() || defaultExploreGroupBy(source) || undefined;
}

/**
 * Group by is stored comma-separated because that is what the query layer
 * splits, and it splits bracket-aware — `ResourceAttributes['a,b']` and
 * `concat(a, b)` are one grouping each, not two. Parse the same way so the
 * picker cannot turn one column into two by round-tripping it.
 */
export function parseGroupByFields(value: string): string[] {
  return splitAndTrimWithBracket(value).filter(Boolean);
}

export function formatGroupByFields(fields: string[]): string {
  return fields.join(', ');
}
