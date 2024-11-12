import express from 'express';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createSavedSearch,
  deleteSavedSearch,
  getSavedSearch,
  getSavedSearches,
  updateSavedSearch,
} from '@/controllers/savedSearch';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { SavedSearchSchema } from '@/utils/commonTypes';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const savedSearches = await getSavedSearches(teamId.toString());

    return res.json(savedSearches);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({
    body: SavedSearchSchema.omit({ id: true }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      const savedSearch = await createSavedSearch(teamId.toString(), req.body);

      return res.json(savedSearch);
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/:id',
  validateRequest({
    body: SavedSearchSchema.partial(),
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      const savedSearch = await getSavedSearch(
        teamId.toString(),
        req.params.id,
      );

      if (!savedSearch) {
        res.status(404).send('Saved search not found');
        return;
      }

      const updates = _.omitBy(req.body, _.isNil);

      const updatedSavedSearch = await updateSavedSearch(
        teamId.toString(),
        req.params.id,
        {
          ...savedSearch.toJSON(),
          source: savedSearch.source.toString(),
          ...updates,
        },
      );

      if (!updatedSavedSearch) {
        res.status(404).send('Saved search not found');
        return;
      }

      return res.json(updatedSavedSearch);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      await deleteSavedSearch(teamId.toString(), req.params.id);

      return res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);

export default router;
