import express from 'express';
import { z } from 'zod';

import { KnowledgeTargetError } from '@/knowledge/errors';
import {
  listAffectedNodes,
  listIncidents,
} from '@/knowledge/incidents/listing';
import { buildPlaybook, parseArgs } from '@/knowledge/incidents/playbook';
import { getIncident, listActions } from '@/knowledge/incidents/store';
import type { ActionRow, IncidentRow } from '@/knowledge/incidents/types';
import {
  type KnowledgeTarget,
  resolveKnowledgeTarget,
} from '@/knowledge/target';
import {
  findCalleePath,
  type Graph,
  type GraphPath,
  loadGraph,
} from '@/knowledge/topology/graph';
import { parseNodeKey } from '@/knowledge/topology/nodeKey';
import { refreshTopologyIfStale } from '@/knowledge/topology/refresh';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import Team from '@/models/team';
import { setBusinessContext, withSpan } from '@/utils/instrumentation';

const router = express.Router();

// shortcut: newest incidents only, so a long history does not swamp the canvas; page if teams need more
const MAX_INCIDENTS = 200;

type GraphNode = {
  key: string;
  kind: 'service' | 'datastore' | 'incident';
  label: string;
};
type GraphEdgeOut = {
  src: string;
  dst: string;
  rel: string;
  requestCount?: number;
  errorCount?: number;
  p95Ms?: number;
};

const toNode = (key: string): GraphNode | null => {
  try {
    return { key, ...parseNodeKey(key) };
  } catch {
    return null;
  }
};

function toIncidentGraph(graph: Graph, incidents: IncidentRow[]) {
  const nodes = new Map<string, GraphNode>();
  const addNode = (key: string) => {
    const node = nodes.has(key) ? null : toNode(key);
    if (node) nodes.set(key, node);
  };
  graph.nodes.forEach(addNode);

  const edges: GraphEdgeOut[] = [...graph.out.values()]
    .flat()
    .map(e => ({ ...e, rel: 'CALLS' }));
  for (const i of incidents) {
    const key = `incident:${i.incident_id}`;
    nodes.set(key, { key, kind: 'incident', label: i.title });
    // Endpoints can be missing from the topology once their traffic stops.
    for (const [rel, dst] of [
      ['ALERTED_ON', i.alerting_node],
      ['ROOT_CAUSE_AT', i.root_cause_node],
    ]) {
      if (!dst) continue;
      addNode(dst);
      if (nodes.has(dst)) edges.push({ src: key, dst, rel });
    }
  }

  return { nodes: [...nodes.values()], edges, incidents: incidents.map(toUi) };
}

// Field by field, so embeddings and other internal columns never reach the browser.
const toUi = (i: IncidentRow) => ({
  incidentId: i.incident_id,
  title: i.title,
  status: i.status,
  confirmed: i.confirmed_by !== '',
  confirmedBy: i.confirmed_by,
  alertingNode: i.alerting_node,
  rootCauseNode: i.root_cause_node,
  rootCause: i.root_cause,
  resolution: i.resolution,
  openedAt: i.opened_at,
  resolvedAt: i.resolved_at,
});

const num = z.number();
const storedPathSchema = z.object({
  nodes: z.array(z.string()),
  edges: z.array(
    z.object({
      src: z.string(),
      dst: z.string(),
      requestCount: num,
      errorCount: num,
      p95Ms: num,
    }),
  ),
});

const parsePath = (text: string): GraphPath | null => {
  try {
    return storedPathSchema.parse(JSON.parse(text));
  } catch {
    return null;
  }
};

function toIncidentDetail(
  incident: IncidentRow,
  actions: ActionRow[],
  affectedNodes: string[],
  graph: Graph,
) {
  const { alerting_node: from, root_cause_node: to } = incident;
  const path = parsePath(incident.path);
  const currentPath = to ? findCalleePath(graph, from, to) : null;
  const keys = new Set(
    [from, to, ...affectedNodes, ...(path?.nodes ?? [])].filter(Boolean),
  );
  currentPath?.nodes.forEach(k => keys.add(k));
  // Current traffic that links an affected node to the rest of the picture.
  const affectedEdges = [...graph.out.values()]
    .flat()
    .filter(
      e =>
        keys.has(e.src) &&
        keys.has(e.dst) &&
        (affectedNodes.includes(e.src) || affectedNodes.includes(e.dst)),
    );
  return {
    incident: toUi(incident),
    actions: actions.map(a => ({
      seq: a.seq,
      ts: a.ts,
      actionType: a.action_type,
      tool: a.tool,
      args: parseArgs(a.args),
      reason: a.reason,
      outcome: a.outcome,
      summary: a.summary,
    })),
    playbook: buildPlaybook(incident, actions),
    path,
    currentPath,
    affectedNodes,
    affectedEdges,
    nodes: [...keys].flatMap(k => toNode(k) ?? []),
  };
}

const handle =
  (
    spanName: string,
    fn: (
      req: express.Request,
      res: express.Response,
      target: KnowledgeTarget,
    ) => Promise<unknown>,
  ) =>
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      setBusinessContext({
        teamId: teamId.toString(),
        userId: userId.toString(),
      });
      await withSpan(spanName, async () => {
        const team = await Team.findById(teamId).select(
          'isKnowledgeGraphEnabled',
        );
        if (!team?.isKnowledgeGraphEnabled) {
          res.status(404).json({
            message: 'The knowledge graph is not enabled for this team',
          });
          return;
        }
        await fn(req, res, await resolveKnowledgeTarget(teamId.toString()));
      });
    } catch (e) {
      if (e instanceof KnowledgeTargetError) {
        return res.status(412).json({ message: e.message });
      }
      next(e);
    }
  };

router.get(
  '/graph',
  handle('knowledge.ui_graph', async (_req, res, target) => {
    await refreshTopologyIfStale(target);
    const [graph, incidents] = await Promise.all([
      loadGraph(target),
      listIncidents(target, {
        includeUnconfirmed: true,
        limit: MAX_INCIDENTS,
      }),
    ]);
    res.json(toIncidentGraph(graph, incidents));
  }),
);

const idParams = z.object({ id: z.string().uuid() });

const findIncident = (target: KnowledgeTarget, params: unknown) => {
  const parsed = idParams.safeParse(params);
  return parsed.success ? getIncident(target, parsed.data.id) : null;
};

router.get(
  '/incidents/:id',
  handle('knowledge.ui_incident', async (req, res, target) => {
    const incident = await findIncident(target, req.params);
    if (!incident) {
      res.status(404).json({ message: 'Incident not found' });
      return;
    }
    const [actions, affected, graph] = await Promise.all([
      listActions(target, incident.incident_id),
      listAffectedNodes(target, incident.incident_id),
      loadGraph(target),
    ]);
    res.json(toIncidentDetail(incident, actions, affected, graph));
  }),
);

router.get(
  '/incidents/:id/playbook',
  handle('knowledge.ui_playbook', async (req, res, target) => {
    const incident = await findIncident(target, req.params);
    if (!incident) {
      res.status(404).json({ message: 'Incident not found' });
      return;
    }
    const actions = await listActions(target, incident.incident_id);
    res.json(buildPlaybook(incident, actions));
  }),
);

export default router;
