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
 * Returns the team-level pinned filters for the source.
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
      const { teamId } = getNonNullUserWithTeam(req);
      const source = req.query.source as string;

      const doc = await getPinnedFilters(teamId.toString(), source);

      return res.json({
        team: doc
          ? {
              id: doc._id.toString(),
              fields: doc.fields,
              filters: doc.filters,
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
  fields: z.array(z.string()),
  filters: PinnedFiltersValueSchema,
});

/**
 * PUT /pinned-filters
 * Upserts team-level pinned filters for the given source.
 */
router.put(
  '/',
  validateRequest({ body: updateBodySchema }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const source = req.body.source as string;
      const fields = req.body.fields as string[];
      const filters = req.body.filters as Record<string, (string | boolean)[]>;

      const doc = await updatePinnedFilters(teamId.toString(), source, {
        fields,
        filters,
      });

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
