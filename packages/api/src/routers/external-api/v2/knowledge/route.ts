import type express from 'express';

import type { IncidentRow } from '@/knowledge/incidents/types';
import {
  type KnowledgeTarget,
  resolveKnowledgeTarget,
} from '@/knowledge/target';
import { setBusinessContext, withSpan } from '@/utils/instrumentation';

type TeamCtx = {
  req: express.Request;
  res: express.Response;
  teamId: string;
  actor: string;
};
type Ctx = TeamCtx & { target: KnowledgeTarget };

// Runs the handler in a span named after the route template, so span names
// stay low-cardinality. No knowledge target: settings must work without one.
export const teamRoute =
  (spanName: string, fn: (c: TeamCtx) => Promise<unknown>) =>
  async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    try {
      const teamId = req.user?.team?.toString();
      const actor = req.user?._id?.toString();
      if (!teamId || !actor) return res.sendStatus(403);
      setBusinessContext({ teamId, userId: actor });
      await withSpan(spanName, () => fn({ req, res, teamId, actor }));
    } catch (e) {
      next(e);
    }
  };

export const route = (spanName: string, fn: (c: Ctx) => Promise<unknown>) =>
  teamRoute(spanName, async c =>
    fn({ ...c, target: await resolveKnowledgeTarget(c.teamId) }),
  );

// Embeddings are ranking data and the path is for the UI; neither is returned over REST.
export const publicIncident = ({
  embedding: _embedding,
  path: _path,
  ...rest
}: IncidentRow) => rest;
