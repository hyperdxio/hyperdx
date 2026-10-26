import { escapeRegExp } from 'lodash';
import type { Edge, Node } from '@xyflow/react';

import {
  errorRate,
  errorRateColors,
  incomingErrorRates,
  type TopologyNodeData,
} from './graphMapping';
import type {
  IncidentDetail,
  KgEdge,
  KgIncident,
  KgPath,
  KgPathEdge,
} from './types';

export type PathSource = 'resolve' | 'current' | 'not_found' | 'open';

export const PATH_SOURCE_LABEL: Record<PathSource, string> = {
  resolve: 'At resolve time',
  current: 'Current traffic',
  not_found: 'Path not found',
  open: 'No root cause yet',
};

// Topology is only kept as current traffic, so the snapshot taken at resolve wins.
function choosePath(d: IncidentDetail): {
  source: PathSource;
  path: KgPath | null;
} {
  if (!d.incident.rootCauseNode) return { source: 'open', path: null };
  if (d.path) return { source: 'resolve', path: d.path };
  if (d.currentPath) return { source: 'current', path: d.currentPath };
  return { source: 'not_found', path: null };
}

function edgeLabel(e: KgPathEdge) {
  const rate = errorRate(e.requestCount, e.errorCount) ?? 0;
  return `${e.requestCount.toLocaleString()} req, ${rate.toFixed(1)}% errors, p95 ${Math.round(e.p95Ms)} ms`;
}

const edgeColor = (e: KgPathEdge) =>
  errorRateColors(errorRate(e.requestCount, e.errorCount)).borderColor;

// A pill behind the text so edges, dashed ones included, never run through it.
const labelProps = {
  labelStyle: { fontSize: 12, fontWeight: 500, fill: 'var(--color-text)' },
  labelShowBg: true,
  labelBgStyle: {
    fill: 'var(--color-bg-surface)',
    stroke: 'var(--color-border)',
  },
  labelBgPadding: [8, 4] as [number, number],
  labelBgBorderRadius: 10,
};

export function toIncidentFlow(
  d: IncidentDetail,
  highlighted: ReadonlySet<string>,
  topology: KgEdge[] = [],
): { nodes: Node[]; edges: Edge[]; source: PathSource } {
  const { source, path } = choosePath(d);
  const { alertingNode, rootCauseNode } = d.incident;
  const pathNodes = new Set(path?.nodes ?? []);
  const keys = [
    ...new Set(
      [alertingNode, ...pathNodes, rootCauseNode, ...d.affectedNodes].filter(
        Boolean,
      ),
    ),
  ];
  const visible = new Set(keys);
  const pathEdges = path?.edges ?? [];
  const onPath = new Set(pathEdges.map(e => `${e.src}->${e.dst}`));
  const context = d.affectedEdges.filter(
    e =>
      visible.has(e.src) &&
      visible.has(e.dst) &&
      !onPath.has(`${e.src}->${e.dst}`),
  );
  const drawn = [...pathEdges, ...context];
  const topologyRate = incomingErrorRates(
    topology.filter(e => e.rel === 'CALLS'),
  );
  const drawnRate = incomingErrorRates(drawn);
  // Entry points like a gateway have no traced callers, so fall back to the calls they make.
  const outgoingRate = incomingErrorRates(
    drawn.map(e => ({ ...e, dst: e.src })),
  );
  const nodeRate = (key: string) =>
    topologyRate(key) ?? drawnRate(key) ?? outgoingRate(key);
  const byKey = new Map(d.nodes.map(n => [n.key, n]));
  const roleOf = (key: string): TopologyNodeData['role'] => {
    if (key === rootCauseNode) return 'target';
    if (key === alertingNode) return 'start';
    return pathNodes.has(key) ? undefined : 'affected';
  };

  const nodes: Node[] = keys.map(key => ({
    id: key,
    type: 'topology',
    position: { x: 0, y: 0 },
    data: {
      label: byKey.get(key)?.label ?? key,
      kind: byKey.get(key)?.kind === 'datastore' ? 'datastore' : 'service',
      errorRate: nodeRate(key),
      highlighted: highlighted.has(key),
      role: roleOf(key),
    } satisfies TopologyNodeData,
  }));

  const edges: Edge[] = [
    ...pathEdges.map(e => ({
      id: `path:${e.src}->${e.dst}`,
      source: e.src,
      target: e.dst,
      animated: true,
      label: edgeLabel(e),
      ...labelProps,
      style: { stroke: edgeColor(e), strokeWidth: 2.5 },
    })),
    ...context.map(e => ({
      id: `context:${e.src}->${e.dst}`,
      source: e.src,
      target: e.dst,
      style: { stroke: edgeColor(e), strokeWidth: 1, opacity: 0.6 },
    })),
  ];
  if (source === 'not_found' && alertingNode !== rootCauseNode) {
    edges.push({
      id: 'not-found',
      source: alertingNode,
      target: rootCauseNode,
      label: PATH_SOURCE_LABEL.not_found,
      ...labelProps,
      style: {
        stroke: 'var(--color-text-muted)',
        strokeWidth: 1.5,
        strokeDasharray: '6 4',
      },
    });
  }
  return { nodes, edges, source };
}

const strings = (v: unknown): string[] => {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.flatMap(strings);
  if (v && typeof v === 'object') return Object.values(v).flatMap(strings);
  return [];
};

// Nodes a step concerns: a node key anywhere in its args, or its name as a whole word.
export function stepNodes(
  args: unknown,
  nodes: Array<{ key: string; label: string }>,
): Set<string> {
  const texts = strings(args);
  return new Set(
    nodes
      .filter(n => {
        const word = new RegExp(
          `(^|[^\\w-])${escapeRegExp(n.label)}($|[^\\w-])`,
        );
        return texts.some(t => t.includes(n.key) || word.test(t));
      })
      .map(n => n.key),
  );
}

export const nodeName = (key: string) => key.slice(key.indexOf(':') + 1);

export function filterIncidents(incidents: KgIncident[], query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return incidents;
  return incidents.filter(i =>
    [i.title, nodeName(i.alertingNode), nodeName(i.rootCauseNode)].some(s =>
      s.toLowerCase().includes(q),
    ),
  );
}
