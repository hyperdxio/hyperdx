import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
import type { TreeNodeData } from '@mantine/core';

/** One metric from the catalog: a (name, kind) pair plus its OTel metadata. */
export type MetricCatalogEntry = {
  name: string;
  type: MetricsDataType;
  /** UCUM code, e.g. `By` or `ms`. Absent on non-OTel schemas. */
  unit?: string;
  description?: string;
};

/**
 * Segment separator used to build the prefix hierarchy. OTel semantic
 * conventions use dots (`system.cpu.utilization`); Prometheus exporters use
 * underscores (`node_cpu_seconds_total`).
 */
export type MetricNameDelimiter = '.' | '_';

/**
 * Prefix on group (non-leaf) node values so a group can never collide with a
 * leaf value, which is derived from the metric kind instead.
 */
const GROUP_VALUE_PREFIX = 'g:';

/**
 * Separator inside a leaf value. Not present in any `MetricsDataType` member
 * (`exponential histogram` contains a space, so a space is unsafe), and not a
 * legal character in an OTel metric name.
 */
const LEAF_VALUE_SEPARATOR = '|';

/**
 * Stable tree node value for a metric. The same name can exist under more than
 * one kind (e.g. a gauge and a sum), so the kind is part of the identity.
 */
export function metricLeafValue(entry: MetricCatalogEntry): string {
  return `${entry.type}${LEAF_VALUE_SEPARATOR}${entry.name}`;
}

/**
 * Merge the per-kind result sets into one sorted catalog, dropping empty names
 * and any (name, kind) seen twice.
 *
 * `summary` never appears here: the query renderer has no summary translation,
 * so such a metric could be browsed but never charted.
 */
export function mergeMetricCatalog(
  perKind: MetricCatalogEntry[][],
): MetricCatalogEntry[] {
  const entries: MetricCatalogEntry[] = [];
  const seen = new Set<string>();

  for (const group of perKind) {
    for (const entry of group) {
      if (!entry.name) continue;
      const key = metricLeafValue(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
    }
  }

  return entries.sort(
    (a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type),
  );
}

/**
 * Case-insensitive substring match on the metric name or its description, so a
 * user who knows what a metric measures but not what it is called can still
 * find it.
 */
export function filterMetricEntries(
  entries: MetricCatalogEntry[],
  query: string,
): MetricCatalogEntry[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return entries;
  return entries.filter(
    entry =>
      entry.name.toLowerCase().includes(trimmed) ||
      entry.description?.toLowerCase().includes(trimmed),
  );
}

/**
 * Split a metric name into path segments.
 *
 * The separator is chosen **per name**, not per source: `.` when the name has
 * one (OpenTelemetry semantic conventions), otherwise `_` (Prometheus
 * exporters). A single source-wide separator does not survive contact with a
 * real deployment — any OTel install carries collector self-telemetry
 * (`otelcol_exporter_queue_size`, thousands of names) alongside application
 * metrics (`system.cpu.utilization`, dozens), so whichever separator won the
 * vote would flatten the other family into an unnavigable root.
 *
 * Deciding per name also keeps compound leaf segments intact:
 * `http.server.request_duration` splits into `http` / `server` /
 * `request_duration`, never `request` / `duration`.
 */
export function metricNameSegments(name: string): {
  segments: string[];
  delimiter: MetricNameDelimiter;
} {
  const delimiter: MetricNameDelimiter = name.includes('.') ? '.' : '_';
  return {
    segments: name.split(delimiter).filter(s => s.length > 0),
    delimiter,
  };
}

type MutableNode = {
  /** Child groups, keyed by path segment. */
  children: Map<string, MutableNode>;
  /** Metrics whose final segment lives directly on this node. */
  leaves: MetricCatalogEntry[];
  /**
   * Separator of the name that created this node, used to render a collapsed
   * chain with the punctuation the underlying metric actually uses.
   */
  delimiter: MetricNameDelimiter;
};

function emptyNode(delimiter: MetricNameDelimiter = '.'): MutableNode {
  return { children: new Map(), leaves: [], delimiter };
}

function countLeaves(node: MutableNode): number {
  let total = node.leaves.length;
  for (const child of node.children.values()) {
    total += countLeaves(child);
  }
  return total;
}

export type BuildMetricNameTreeOptions = {
  /**
   * Cap on rendered leaves. Mantine's `Tree` does not virtualize, so an
   * unfiltered catalog of several thousand metrics must be bounded.
   */
  maxLeaves?: number;
  /**
   * Merge a group that has no metrics of its own and exactly one child group
   * into that child, so `system` → `cpu` → `utilization` renders as
   * `system.cpu` → `utilization` rather than a single-file corridor.
   */
  collapseSingleChildChains?: boolean;
};

export type MetricNameTree = {
  nodes: TreeNodeData[];
  /** Leaf node value → the metric it represents. */
  leafIndex: Map<string, MetricCatalogEntry>;
  /** Leaves actually present in `nodes`. */
  leafCount: number;
  /** Leaves dropped by `maxLeaves`; surface this rather than silently truncating. */
  truncatedLeafCount: number;
};

/**
 * Build a prefix hierarchy over metric names.
 *
 * A metric that is also a prefix of other metrics (both `system.cpu` and
 * `system.cpu.utilization` exist) renders as a leaf sibling of the group with
 * the same label — correct, and disambiguated by the kind badge.
 */
export function buildMetricNameTree(
  entries: MetricCatalogEntry[],
  {
    maxLeaves,
    collapseSingleChildChains = true,
  }: BuildMetricNameTreeOptions = {},
): MetricNameTree {
  const included =
    maxLeaves != null && entries.length > maxLeaves
      ? entries.slice(0, maxLeaves)
      : entries;
  const truncatedLeafCount = entries.length - included.length;

  const root = emptyNode();
  for (const entry of included) {
    const { segments, delimiter } = metricNameSegments(entry.name);
    // A name that is only delimiters (or empty) has no usable path — hang it
    // off the root so it stays reachable.
    const groupPath = segments.slice(0, -1);

    let node = root;
    for (const segment of groupPath) {
      let child = node.children.get(segment);
      if (!child) {
        child = emptyNode(delimiter);
        node.children.set(segment, child);
      }
      node = child;
    }
    node.leaves.push(entry);
  }

  const leafIndex = new Map<string, MetricCatalogEntry>();

  const toTreeNodes = (node: MutableNode, path: string[]): TreeNodeData[] => {
    const groups: TreeNodeData[] = [];

    for (const segment of [...node.children.keys()].sort((a, b) =>
      a.localeCompare(b),
    )) {
      let child = node.children.get(segment)!;
      const labelSegments = [segment];
      let childPath = [...path, segment];

      if (collapseSingleChildChains) {
        while (child.leaves.length === 0 && child.children.size === 1) {
          const [onlySegment, onlyChild] = [...child.children.entries()][0];
          labelSegments.push(onlySegment);
          childPath = [...childPath, onlySegment];
          child = onlyChild;
        }
      }

      groups.push({
        // Joined with a character no metric name may contain, so a group value
        // is unique regardless of which separator its names use.
        value: `${GROUP_VALUE_PREFIX}${childPath.join(LEAF_VALUE_SEPARATOR)}`,
        // Rendered with the separator the underlying names actually use, so a
        // collapsed chain reads as a real name prefix.
        label: labelSegments.join(child.delimiter),
        nodeProps: { leafCount: countLeaves(child) },
        children: toTreeNodes(child, childPath),
      });
    }

    const leaves: TreeNodeData[] = node.leaves
      .slice()
      .sort(
        (a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type),
      )
      .map(entry => {
        const value = metricLeafValue(entry);
        leafIndex.set(value, entry);
        const { segments } = metricNameSegments(entry.name);
        return {
          value,
          label: segments[segments.length - 1] ?? entry.name,
          nodeProps: { entry },
        };
      });

    // Groups before leaves: the hierarchy reads top-down, and a group's label
    // can repeat a sibling leaf's label.
    return [...groups, ...leaves];
  };

  const nodes = toTreeNodes(root, []);

  return {
    nodes,
    leafIndex,
    leafCount: leafIndex.size,
    truncatedLeafCount,
  };
}

/**
 * Group values for every ancestor of a metric, so a preselected metric's branch
 * can be opened. Must mirror the value scheme `buildMetricNameTree` emits.
 *
 * Includes the values a *non-collapsed* chain would have; expanding a value that
 * collapsing removed is harmless, since the expanded state is a plain record.
 */
export function ancestorGroupValues(name: string): string[] {
  const { segments } = metricNameSegments(name);
  return segments
    .slice(0, -1)
    .map(
      (_, i) =>
        `${GROUP_VALUE_PREFIX}${segments.slice(0, i + 1).join(LEAF_VALUE_SEPARATOR)}`,
    );
}

/** Every group node value in the tree, for expand-all while searching. */
export function collectGroupValues(nodes: TreeNodeData[]): string[] {
  const values: string[] = [];
  const walk = (list: TreeNodeData[]) => {
    for (const node of list) {
      if (node.children?.length) {
        values.push(node.value);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return values;
}
