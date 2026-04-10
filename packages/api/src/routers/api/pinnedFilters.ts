import { PinnedFiltersValueSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  getPinnedFilters,
  updatePinnedFilters,
} from '@/controllers/pinnedFilter';
import { getSource } from '@/controllers/sources';
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
      const { source } = req.query;

      // Verify the source belongs to this team
      const sourceDoc = await getSource(teamId.toString(), source);
      if (!sourceDoc) {
        return res.status(404).json({ error: 'Source not found' });
      }

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
  fields: z.array(z.string().max(1024)).max(100),
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
      const { source, fields, filters } = req.body;

      // Verify the source belongs to this team
      const sourceDoc = await getSource(teamId.toString(), source);
      if (!sourceDoc) {
        return res.status(404).json({ error: 'Source not found' });
      }

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
