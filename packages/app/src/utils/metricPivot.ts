import { TSource } from '@hyperdx/common-utils/dist/types';

/** A group column / value pair decoded from a chart series key. */
export type GroupFilter = { column: string; value: any };

export type TranslatedGroupFilters = {
  /** Filters that address the same attribute on the target source. */
  filters: GroupFilter[];
  /** Columns with no counterpart on the target source; not carried over. */
  droppedColumns: string[];
};

/**
 * `ResourceAttributes['k8s.pod.name']` split into its map expression and its
 * quoted key. Anything else — a bare column, a function call — has no key to
 * re-address and so cannot be translated.
 */
const ATTRIBUTE_LOOKUP = /^\s*(.+?)\s*\[\s*('(?:[^']|'')*'|"[^"]*")\s*\]\s*$/;

/** Not every source kind has resource attributes — PromQL sources have none. */
function resourceAttributesExpression(
  source: TSource | undefined,
): string | undefined {
  if (!source || !('resourceAttributesExpression' in source)) return undefined;
  return source.resourceAttributesExpression?.trim() || undefined;
}

/**
 * Re-address a metric chart's group-by columns against the source that holds
 * the rows.
 *
 * Clicking one series of a metric chart asks "what was this pod doing?", so the
 * pod has to survive the jump to logs or traces. The two sources name their
 * attribute maps independently — one may call it `ResourceAttributes` and the
 * other `resource_attributes` — so the map expression is swapped while the key
 * is kept.
 *
 * Only resource attributes are carried. They identify the entity that emitted
 * the telemetry and OpenTelemetry keeps them consistent across signals, so a
 * pod name means the same thing on both sides. A metric's own data-point
 * attributes have no such guarantee: a key that exists on the metric and not on
 * the log table yields a filter that matches nothing, which reads as "this pod
 * logged nothing" rather than "that filter was nonsense". Those are dropped and
 * reported instead.
 */
export function translateMetricGroupFilters({
  groupFilters,
  metricSource,
  targetSource,
}: {
  groupFilters: GroupFilter[] | undefined;
  metricSource: TSource | undefined;
  targetSource: TSource | undefined;
}): TranslatedGroupFilters {
  const from = resourceAttributesExpression(metricSource);
  const to = resourceAttributesExpression(targetSource);

  const filters: GroupFilter[] = [];
  const droppedColumns: string[] = [];

  for (const filter of groupFilters ?? []) {
    if (!filter?.column || filter.value == null) continue;

    const match = from && to ? ATTRIBUTE_LOOKUP.exec(filter.column) : null;
    if (match && match[1].trim() === from) {
      filters.push({ column: `${to}[${match[2]}]`, value: filter.value });
    } else {
      droppedColumns.push(filter.column);
    }
  }

  return { filters, droppedColumns };
}
