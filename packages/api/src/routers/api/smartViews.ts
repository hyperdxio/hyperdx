import {
  SmartViewResourceSchema,
  SmartViewSchema,
  SmartViewWithoutIdSchema,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createSmartView,
  deleteSmartView,
  getSmartView,
  getSmartViews,
  updateSmartView,
} from '@/controllers/smartView';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

router.get(
  '/',
  validateRequest({
    query: z.object({
      resource: SmartViewResourceSchema.optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);

      const views = await getSmartViews(
        userId.toString(),
        teamId.toString(),
        req.query.resource,
      );

      return res.json(views);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/',
  validateRequest({
    body: SmartViewWithoutIdSchema,
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);

      const view = await createSmartView(
        userId.toString(),
        teamId.toString(),
        req.body,
      );

      return res.json(view.toJSON());
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/:id',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
    body: SmartViewWithoutIdSchema.partial(),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { id } = req.params;

      const existing = await getSmartView(
        id,
        userId.toString(),
        teamId.toString(),
      );
      if (existing == null) {
        return res.sendStatus(404);
      }

      const updates = _.omitBy(req.body, _.isUndefined);
      const updated = await updateSmartView(
        id,
        userId.toString(),
        teamId.toString(),
        updates,
      );

      return res.json(updated?.toJSON());
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { id } = req.params;

      const result = await deleteSmartView(
        id,
        userId.toString(),
        teamId.toString(),
      );
      if (result.deletedCount === 0) {
        return res.sendStatus(404);
      }

      return res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);

export default router;
