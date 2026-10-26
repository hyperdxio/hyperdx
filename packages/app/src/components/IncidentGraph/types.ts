// Response shapes of the API's internal incidentGraph router.
type KgNodeKind = 'service' | 'datastore' | 'incident';

type KgNode = { key: string; kind: KgNodeKind; label: string };

export type KgEdge = {
  src: string;
  dst: string;
  rel: string;
  requestCount?: number;
  errorCount?: number;
  p95Ms?: number;
};

export type KgIncident = {
  incidentId: string;
  title: string;
  status: 'open' | 'resolved';
  confirmed: boolean;
  confirmedBy: string;
  alertingNode: string;
  rootCauseNode: string;
  rootCause: string;
  resolution: string;
  openedAt: string;
  resolvedAt: string | null;
};

export type IncidentGraphResponse = {
  nodes: KgNode[];
  edges: KgEdge[];
  incidents: KgIncident[];
};

export type Playbook = {
  incidentId: string;
  rootCause: string;
  rootCauseNode: string;
  resolution: string;
  steps: Array<{
    seq: number;
    actionType: string;
    tool: string;
    reason: string;
    summary: string;
    outcome: 'led_to_fix' | 'useful';
  }>;
  ruledOut: Array<{ seq: number; summary: string }>;
};

export type KgOutcome = 'unknown' | 'led_to_fix' | 'useful' | 'dead_end';

export type KgAction = {
  seq: number;
  ts: string;
  actionType: string;
  tool: string;
  args: Record<string, unknown>;
  reason: string;
  outcome: KgOutcome;
  summary: string;
};

export type KgPathEdge = Required<Omit<KgEdge, 'rel'>>;
export type KgPath = { nodes: string[]; edges: KgPathEdge[] };

export type IncidentDetail = {
  incident: KgIncident;
  actions: KgAction[];
  playbook: Playbook;
  // Captured when the incident was resolved; null for older incidents.
  path: KgPath | null;
  currentPath: KgPath | null;
  affectedNodes: string[];
  affectedEdges: KgPathEdge[];
  nodes: KgNode[];
};
