import { PinnedFiltersValueSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  getPinnedFilters,
  updatePinnedFilters,
} from '@/controllers/pinnedFilter';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

/**
 * GET /pinned-filters?source=<sourceId>
 * Returns both team-level and personal pinned filters for the source.
 */
router.get(
  '/',
  validateRequest({
    query: z.object({
      source: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const source = req.query.source as string;

      const result = await getPinnedFilters(
        teamId.toString(),
        source,
        userId.toString(),
      );

      return res.json({
        team: result.team
          ? {
              id: result.team._id.toString(),
              fields: result.team.fields,
              filters: result.team.filters,
            }
          : null,
        personal: result.personal
          ? {
              id: result.personal._id.toString(),
              fields: result.personal.fields,
              filters: result.personal.filters,
            }
          : null,
      });
    } catch (e) {
      next(e);
    }
  },
);

const updateBodySchema = z.object({
  source: objectIdSchema,
  scope: z.enum(['team', 'personal']),
  fields: z.array(z.string()),
  filters: PinnedFiltersValueSchema,
});

/**
 * PUT /pinned-filters
 * Upserts pinned filters for the given source.
 * scope=team -> updates the team-wide pinned filters (user=null)
 * scope=personal -> updates this user's personal pinned filters
 */
router.put(
  '/',
  validateRequest({ body: updateBodySchema }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const source = req.body.source as string;
      const scope = req.body.scope as 'team' | 'personal';
      const fields = req.body.fields as string[];
      const filters = req.body.filters as Record<string, (string | boolean)[]>;

      const doc = await updatePinnedFilters(
        teamId.toString(),
        source,
        scope === 'personal' ? userId.toString() : null,
        { fields, filters },
      );

      return res.json({
        id: doc._id.toString(),
        fields: doc.fields,
        filters: doc.filters,
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
