import {
  SourceFormSchema,
  sourceFormSchemaWithout,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createSource,
  deleteSource,
  getSources,
  updateSource,
} from '@/controllers/sources';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const sources = await getSources(teamId.toString());

    return res.json(sources.map(s => s.toJSON({ getters: true })));
  } catch (e) {
    next(e);
  }
});

const SourceFormSchemaNoId = sourceFormSchemaWithout({ id: true });

router.post(
  '/',
  validateRequest({
    body: SourceFormSchemaNoId,
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      // TODO: HDX-1768 Eliminate type assertion
      const source = await createSource(teamId.toString(), {
        ...req.body,
        team: teamId,
      } as any);

      res.json(source);
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/:id',
  validateRequest({
    body: SourceFormSchema,
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      // TODO: HDX-1768 Eliminate type assertion
      const source = await updateSource(teamId.toString(), req.params.id, {
        ...req.body,
        team: teamId,
      } as any);

      if (!source) {
        res.status(404).send('Source not found');
        return;
      }

      return res.status(200).send();
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      await deleteSource(teamId.toString(), req.params.id);

      return res.status(200).send();
    } catch (e) {
      next(e);
    }
  },
);

export default router;
