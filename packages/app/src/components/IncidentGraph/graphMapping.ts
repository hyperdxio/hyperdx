import type { Edge, Node } from '@xyflow/react';

import { getNodeColors } from '@/components/ServiceMap/utils';

import type { IncidentGraphResponse, KgIncident } from './types';

export type TopologyNodeData = {
  label: string;
  kind: 'service' | 'datastore';
  // Percent of incoming calls that failed; null when nothing calls the node.
  errorRate: number | null;
  highlighted: boolean;
  // Set in the incident view: where the alert fired, where the cause was, or impacted.
  role?: 'start' | 'target' | 'affected';
};
export type IncidentNodeData = { incident: KgIncident; highlighted: boolean };

export type GraphFilters = {
  showIncidents: boolean;
  confirmedOnly: boolean;
  selectedService?: string;
};

// ClickHouse DateTime64 text is UTC without a zone marker.
export const fromClickHouse = (s: string) => `${s.replace(' ', 'T')}Z`;

const incidentKey = (id: string) => `incident:${id}`;

export const errorRateColors = (errorRate: number | null) =>
  getNodeColors(errorRate ?? 0, 0, false, 'errorRate', errorRate !== null);

function visibleIncidents(
  incidents: KgIncident[],
  { showIncidents, confirmedOnly }: GraphFilters,
) {
  if (!showIncidents) return [];
  return incidents.filter(i => !confirmedOnly || i.confirmed);
}

type Traffic = { dst: string; requestCount?: number; errorCount?: number };

export const errorRate = (requests: number, errors: number) =>
  requests > 0 ? (errors / requests) * 100 : null;

// Percent of each node's incoming calls that failed, over the given edges.
export function incomingErrorRates(edges: Traffic[]) {
  const incoming = new Map<string, { requests: number; errors: number }>();
  for (const e of edges) {
    const cur = incoming.get(e.dst) ?? { requests: 0, errors: 0 };
    cur.requests += e.requestCount ?? 0;
    cur.errors += e.errorCount ?? 0;
    incoming.set(e.dst, cur);
  }
  return (key: string) => {
    const r = incoming.get(key);
    return r ? errorRate(r.requests, r.errors) : null;
  };
}

const touchesNode = (i: KgIncident, key: string) =>
  i.alertingNode === key || i.rootCauseNode === key;

export function toFlowElements(
  data: IncidentGraphResponse,
  filters: GraphFilters,
): { nodes: Node[]; edges: Edge[] } {
  const incidents = visibleIncidents(data.incidents, filters);
  const { selectedService } = filters;
  const highlighted = new Set(
    selectedService
      ? incidents
          .filter(i => touchesNode(i, selectedService))
          .map(i => incidentKey(i.incidentId))
      : [],
  );

  const calls = data.edges.filter(e => e.rel === 'CALLS');
  const incomingRate = incomingErrorRates(calls);

  const nodes: Node[] = [];
  for (const n of data.nodes) {
    if (n.kind === 'incident') continue;
    nodes.push({
      id: n.key,
      type: 'topology',
      position: { x: 0, y: 0 },
      data: {
        label: n.label,
        kind: n.kind,
        errorRate: incomingRate(n.key),
        highlighted: n.key === selectedService,
      } satisfies TopologyNodeData,
    });
  }
  for (const incident of incidents) {
    const id = incidentKey(incident.incidentId);
    nodes.push({
      id,
      type: 'incident',
      position: { x: 0, y: 0 },
      data: {
        incident,
        highlighted: highlighted.has(id),
      } satisfies IncidentNodeData,
    });
  }

  const nodeIds = new Set(nodes.map(n => n.id));
  const edges: Edge[] = calls.map(e => ({
    id: `${e.src}->${e.dst}`,
    source: e.src,
    target: e.dst,
    animated: true,
    style: {
      stroke: errorRateColors(errorRate(e.requestCount ?? 0, e.errorCount ?? 0))
        .borderColor,
      strokeWidth: 1.5,
    },
  }));
  for (const e of data.edges) {
    if (e.rel === 'CALLS' || !nodeIds.has(e.src) || !nodeIds.has(e.dst)) {
      continue;
    }
    const isRootCause = e.rel === 'ROOT_CAUSE_AT';
    const width = highlighted.has(e.src) ? 3 : isRootCause ? 2 : 1.5;
    edges.push({
      id: `${e.src}-${e.rel}->${e.dst}`,
      source: e.src,
      target: e.dst,
      label: isRootCause ? 'Root cause' : undefined,
      style: isRootCause
        ? { stroke: 'var(--color-text-danger)', strokeWidth: width }
        : {
            stroke: 'var(--color-text-warning)',
            strokeWidth: width,
            strokeDasharray: '6 4',
          },
    });
  }
  return { nodes, edges };
}
