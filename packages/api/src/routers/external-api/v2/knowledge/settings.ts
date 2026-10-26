import { SourceKind } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { getSource } from '@/controllers/sources';
import Team from '@/models/team';

import { teamRoute } from './route';

const router = express.Router();

const settingsBody = z.object({
  traceSourceId: z.string().nullable().optional(),
  includeUnconfirmed: z.boolean().optional(),
});

async function readSettings(teamId: string) {
  const team = await Team.findById(teamId).select(
    'knowledgeGraphTraceSource knowledgeGraphIncludeUnconfirmed',
  );
  return {
    traceSourceId: team?.knowledgeGraphTraceSource?.toString() ?? null,
    includeUnconfirmed: team?.knowledgeGraphIncludeUnconfirmed ?? false,
  };
}

/**
 * @openapi
 * /api/v2/knowledge/settings:
 *   get:
 *     summary: Get Knowledge Graph Settings
 *     description: Returns the team's knowledge graph trace source and whether retrieval includes unconfirmed incidents.
 *     operationId: getKnowledgeSettings
 *     tags: [Knowledge]
 *     responses:
 *       '200':
 *         description: Current settings
 *       '404':
 *         description: The knowledge graph is not enabled for the team
 */
router.get(
  '/',
  teamRoute('knowledge.get_settings', async ({ res, teamId }) => {
    res.json({ data: await readSettings(teamId) });
  }),
);

/**
 * @openapi
 * /api/v2/knowledge/settings:
 *   put:
 *     summary: Update Knowledge Graph Settings
 *     description: Sets the trace source the knowledge graph reads (null clears it) and whether retrieval includes unconfirmed incidents. Omitted fields keep their value.
 *     operationId: updateKnowledgeSettings
 *     tags: [Knowledge]
 *     responses:
 *       '200':
 *         description: Updated settings
 *       '400':
 *         description: traceSourceId is not a trace source of the team
 *       '404':
 *         description: The knowledge graph is not enabled for the team
 */
router.put(
  '/',
  validateRequest({ body: settingsBody }),
  teamRoute('knowledge.update_settings', async ({ req, res, teamId }) => {
    const { traceSourceId, includeUnconfirmed } = settingsBody.parse(req.body);
    if (traceSourceId) {
      const source = await getSource(teamId, traceSourceId);
      if (source?.kind !== SourceKind.Trace) {
        res.status(400).json({
          message: 'traceSourceId must be a trace source of this team',
        });
        return;
      }
    }
    await Team.updateOne(
      { _id: teamId },
      {
        ...(traceSourceId && { knowledgeGraphTraceSource: traceSourceId }),
        ...(traceSourceId === null && {
          $unset: { knowledgeGraphTraceSource: 1 },
        }),
        ...(includeUnconfirmed !== undefined && {
          knowledgeGraphIncludeUnconfirmed: includeUnconfirmed,
        }),
      },
    );
    res.json({ data: await readSettings(teamId) });
  }),
);

export default router;
