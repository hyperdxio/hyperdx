import { MetricsDataType } from '@hyperdx/common-utils/dist/types';
import type { TreeNodeData } from '@mantine/core';

import {
  ancestorGroupValues,
  buildMetricNameTree,
  collectGroupValues,
  filterMetricEntries,
  mergeMetricCatalog,
  type MetricCatalogEntry,
  metricLeafValue,
  metricNameSegments,
} from '@/utils/metricNameTree';

const gauge = (name: string): MetricCatalogEntry => ({
  name,
  type: MetricsDataType.Gauge,
});
const sum = (name: string): MetricCatalogEntry => ({
  name,
  type: MetricsDataType.Sum,
});

/** Labels of the immediate children of a tree, in render order. */
const labels = (nodes: TreeNodeData[]) => nodes.map(n => String(n.label));

describe('mergeMetricCatalog', () => {
  it('merges the per-kind result sets into one sorted catalog', () => {
    expect(
      mergeMetricCatalog([
        [gauge('b.metric'), gauge('a.metric')],
        [sum('c.metric')],
        [{ name: 'd.metric', type: MetricsDataType.Histogram }],
        [{ name: 'e.metric', type: MetricsDataType.ExponentialHistogram }],
      ]),
    ).toEqual([
      gauge('a.metric'),
      gauge('b.metric'),
      sum('c.metric'),
      { name: 'd.metric', type: MetricsDataType.Histogram },
      { name: 'e.metric', type: MetricsDataType.ExponentialHistogram },
    ]);
  });

  it('keeps the same name under two different kinds', () => {
    expect(
      mergeMetricCatalog([[gauge('queue.size')], [sum('queue.size')]]),
    ).toEqual([gauge('queue.size'), sum('queue.size')]);
  });

  it('drops duplicate (name, kind) pairs and empty names', () => {
    expect(
      mergeMetricCatalog([
        [gauge('a'), gauge('a'), { name: '', type: MetricsDataType.Gauge }],
        [gauge('b')],
      ]),
    ).toEqual([gauge('a'), gauge('b')]);
  });

  it('preserves unit and description', () => {
    expect(
      mergeMetricCatalog([
        [
          {
            name: 'system.memory.usage',
            type: MetricsDataType.Gauge,
            unit: 'By',
            description: 'Bytes in use',
          },
        ],
      ]),
    ).toEqual([
      {
        name: 'system.memory.usage',
        type: MetricsDataType.Gauge,
        unit: 'By',
        description: 'Bytes in use',
      },
    ]);
  });

  it('keeps the first entry when a duplicate carries different metadata', () => {
    const [first] = mergeMetricCatalog([
      [{ name: 'a', type: MetricsDataType.Gauge, description: 'original' }],
      [{ name: 'a', type: MetricsDataType.Gauge, description: 'later' }],
    ]);
    expect(first.description).toBe('original');
  });

  it('tolerates empty input', () => {
    expect(mergeMetricCatalog([])).toEqual([]);
    expect(mergeMetricCatalog([[], []])).toEqual([]);
  });
});

describe('metricNameSegments', () => {
  it('splits an OTel name on dots', () => {
    expect(metricNameSegments('system.cpu.utilization')).toEqual({
      segments: ['system', 'cpu', 'utilization'],
      delimiter: '.',
    });
  });

  it('splits a Prometheus name on underscores', () => {
    expect(metricNameSegments('node_cpu_seconds_total')).toEqual({
      segments: ['node', 'cpu', 'seconds', 'total'],
      delimiter: '_',
    });
  });

  it('leaves a compound leaf segment intact when the name has dots', () => {
    // The whole point of choosing per name: `request_duration` must not
    // fragment into `request` / `duration`.
    expect(metricNameSegments('http.server.request_duration')).toEqual({
      segments: ['http', 'server', 'request_duration'],
      delimiter: '.',
    });
  });

  it('drops empty segments from leading or repeated separators', () => {
    expect(metricNameSegments('.a..b').segments).toEqual(['a', 'b']);
  });

  it('treats a name with no separator as a single segment', () => {
    expect(metricNameSegments('uptime')).toEqual({
      segments: ['uptime'],
      delimiter: '_',
    });
  });
});

describe('ancestorGroupValues', () => {
  it('returns one value per ancestor, excluding the metric itself', () => {
    expect(ancestorGroupValues('system.cpu.utilization')).toEqual([
      'g:system',
      'g:system|cpu',
    ]);
  });

  it('follows the name’s own separator', () => {
    expect(ancestorGroupValues('node_cpu_total')).toEqual([
      'g:node',
      'g:node|cpu',
    ]);
  });

  it('returns nothing for a root-level metric', () => {
    expect(ancestorGroupValues('uptime')).toEqual([]);
  });

  it('matches the group values the tree actually emits', () => {
    const { nodes } = buildMetricNameTree(
      [gauge('system.cpu.utilization'), gauge('system.memory.usage')],
      { collapseSingleChildChains: false },
    );
    // Every ancestor value must exist in the tree, or preselecting a metric
    // would silently fail to open its branch.
    const emitted = new Set(collectGroupValues(nodes));
    for (const value of ancestorGroupValues('system.cpu.utilization')) {
      expect(emitted.has(value)).toBe(true);
    }
  });
});

describe('filterMetricEntries', () => {
  const entries = [
    gauge('system.cpu.utilization'),
    gauge('http.server.duration'),
  ];

  it('matches case-insensitively on a substring', () => {
    expect(filterMetricEntries(entries, 'CPU')).toEqual([
      gauge('system.cpu.utilization'),
    ]);
  });

  it('returns everything for a blank query', () => {
    expect(filterMetricEntries(entries, '   ')).toBe(entries);
  });

  it('returns nothing when no name matches', () => {
    expect(filterMetricEntries(entries, 'zzz')).toEqual([]);
  });
});

describe('buildMetricNameTree', () => {
  it('nests names by prefix and labels leaves with the final segment', () => {
    const { nodes } = buildMetricNameTree(
      [
        gauge('system.cpu.utilization'),
        gauge('system.cpu.time'),
        gauge('system.memory.usage'),
      ],
      { collapseSingleChildChains: false },
    );

    expect(labels(nodes)).toEqual(['system']);
    const system = nodes[0].children!;
    expect(labels(system)).toEqual(['cpu', 'memory']);
    expect(labels(system[0].children!)).toEqual(['time', 'utilization']);
    expect(labels(system[1].children!)).toEqual(['usage']);
  });

  it('collapses single-child chains into one node', () => {
    const { nodes } = buildMetricNameTree([
      gauge('system.cpu.utilization'),
      gauge('system.cpu.time'),
    ]);

    expect(labels(nodes)).toEqual(['system.cpu']);
    expect(nodes[0].value).toBe('g:system|cpu');
    expect(labels(nodes[0].children!)).toEqual(['time', 'utilization']);
  });

  it('does not collapse a group that has metrics of its own', () => {
    const { nodes } = buildMetricNameTree([
      gauge('system.cpu'),
      gauge('system.cpu.utilization'),
    ]);

    // `system` holds the leaf `system.cpu`, so it cannot merge into `cpu`.
    expect(labels(nodes)).toEqual(['system']);
    // Group `cpu` renders before the sibling leaf that shares its label.
    expect(labels(nodes[0].children!)).toEqual(['cpu', 'cpu']);
    expect(nodes[0].children![0].children).toHaveLength(1);
    expect(nodes[0].children![1].children).toBeUndefined();
  });

  it('splits an underscore family on underscores', () => {
    const { nodes } = buildMetricNameTree([
      sum('node_cpu_seconds_total'),
      sum('node_cpu_guest_seconds'),
    ]);

    // `node` and `cpu` collapse; below them the two names diverge at their
    // third segment, so each keeps its own group.
    expect(labels(nodes)).toEqual(['node_cpu']);
    expect(labels(nodes[0].children!)).toEqual(['guest', 'seconds']);
    expect(labels(nodes[0].children![0].children!)).toEqual(['seconds']);
    expect(labels(nodes[0].children![1].children!)).toEqual(['total']);
  });

  it('splits underscore names that share a full prefix', () => {
    const { nodes } = buildMetricNameTree([
      sum('node_memory_active_bytes'),
      sum('node_memory_active_total'),
    ]);

    expect(labels(nodes)).toEqual(['node_memory_active']);
    expect(labels(nodes[0].children!)).toEqual(['bytes', 'total']);
  });

  it('builds both families correctly in a mixed catalog', () => {
    // Regression: a single source-wide separator flattened whichever family
    // was outnumbered. A real deployment has thousands of underscore-style
    // collector metrics next to dozens of dotted application metrics.
    const { nodes } = buildMetricNameTree([
      gauge('system.cpu.utilization'),
      gauge('system.cpu.time'),
      ...Array.from({ length: 50 }, (_, i) =>
        sum(`otelcol_exporter_queue_${i}`),
      ),
    ]);

    expect(labels(nodes)).toEqual(['otelcol_exporter_queue', 'system.cpu']);
    // The dotted family keeps its hierarchy despite being outnumbered 25:1.
    expect(labels(nodes[1].children!)).toEqual(['time', 'utilization']);
    expect(nodes[0].children).toHaveLength(50);
  });

  it('labels each collapsed chain with its own separator', () => {
    const { nodes } = buildMetricNameTree([
      gauge('http.server.request_duration'),
      gauge('http.server.active_requests'),
      sum('node_memory_active_bytes'),
      sum('node_memory_active_total'),
    ]);

    expect(labels(nodes)).toEqual(['http.server', 'node_memory_active']);
    // A dotted name's compound leaf segment survives intact.
    expect(labels(nodes[0].children!)).toEqual([
      'active_requests',
      'request_duration',
    ]);
  });

  it('gives the same name under two kinds two distinct leaves', () => {
    const { nodes, leafIndex, leafCount } = buildMetricNameTree([
      gauge('queue.size'),
      sum('queue.size'),
    ]);

    const leaves = nodes[0].children!;
    expect(leaves).toHaveLength(2);
    expect(new Set(leaves.map(l => l.value)).size).toBe(2);
    expect(leafCount).toBe(2);
    expect(leafIndex.get(metricLeafValue(gauge('queue.size')))).toEqual(
      gauge('queue.size'),
    );
    expect(leafIndex.get(metricLeafValue(sum('queue.size')))).toEqual(
      sum('queue.size'),
    );
  });

  it('keeps group and leaf values from colliding', () => {
    const { nodes } = buildMetricNameTree(
      [gauge('system.cpu'), gauge('system.cpu.utilization')],
      { collapseSingleChildChains: false },
    );
    const [group, leaf] = nodes[0].children!;
    expect(group.value).toBe('g:system|cpu');
    expect(leaf.value).toBe('gauge|system.cpu');
  });

  it('places a single-segment name at the root', () => {
    const { nodes, leafIndex } = buildMetricNameTree([gauge('uptime')]);
    expect(labels(nodes)).toEqual(['uptime']);
    expect(leafIndex.get('gauge|uptime')).toEqual(gauge('uptime'));
  });

  it('reports how many leaves maxLeaves dropped', () => {
    const entries = ['a', 'b', 'c', 'd', 'e'].map(gauge);
    const { leafCount, truncatedLeafCount, leafIndex } = buildMetricNameTree(
      entries,
      { maxLeaves: 2 },
    );

    expect(leafCount).toBe(2);
    expect(truncatedLeafCount).toBe(3);
    expect([...leafIndex.values()]).toEqual([gauge('a'), gauge('b')]);
  });

  it('reports no truncation when under the cap', () => {
    const { truncatedLeafCount } = buildMetricNameTree([gauge('a')], {
      maxLeaves: 10,
    });
    expect(truncatedLeafCount).toBe(0);
  });

  it('carries the subtree leaf count on each group', () => {
    const { nodes } = buildMetricNameTree(
      [
        gauge('system.cpu.utilization'),
        gauge('system.cpu.time'),
        gauge('system.memory.usage'),
      ],
      { collapseSingleChildChains: false },
    );
    expect(nodes[0].nodeProps?.leafCount).toBe(3);
    expect(nodes[0].children![0].nodeProps?.leafCount).toBe(2);
    expect(nodes[0].children![1].nodeProps?.leafCount).toBe(1);
  });

  it('ignores empty segments from leading or repeated delimiters', () => {
    const { nodes, leafIndex } = buildMetricNameTree([gauge('.a..b')]);
    // Empty segments are dropped, so `.a..b` nests as a → b rather than
    // creating blank levels. The leaf still resolves to the original name.
    expect(labels(nodes)).toEqual(['a']);
    expect(labels(nodes[0].children!)).toEqual(['b']);
    expect(leafIndex.get('gauge|.a..b')).toEqual(gauge('.a..b'));
  });

  it('keeps a name made only of delimiters reachable at the root', () => {
    const { nodes, leafIndex } = buildMetricNameTree([gauge('..')]);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].label).toBe('..');
    expect(leafIndex.get('gauge|..')).toEqual(gauge('..'));
  });

  it('handles an empty catalog', () => {
    const { nodes, leafCount, truncatedLeafCount } = buildMetricNameTree([]);
    expect(nodes).toEqual([]);
    expect(leafCount).toBe(0);
    expect(truncatedLeafCount).toBe(0);
  });
});

describe('collectGroupValues', () => {
  it('returns every group value and no leaf values', () => {
    const { nodes } = buildMetricNameTree(
      [gauge('system.cpu.utilization'), gauge('system.memory.usage')],
      { collapseSingleChildChains: false },
    );

    expect(collectGroupValues(nodes)).toEqual([
      'g:system',
      'g:system|cpu',
      'g:system|memory',
    ]);
  });

  it('returns nothing for a flat tree', () => {
    const { nodes } = buildMetricNameTree([gauge('uptime')]);
    expect(collectGroupValues(nodes)).toEqual([]);
  });
});
