import {
  SourceKind,
  SourceSchema,
  SourceSchemaNoId,
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

    const out = sources.map(s => {
      // Typescript gets confused about calling toJSON on the union type, but
      // breaking it out into a switch statement keeps TS happy
      switch (s.kind) {
        case SourceKind.Log:
          return s.toJSON({ getters: true });
        case SourceKind.Trace:
          return s.toJSON({ getters: true });
        case SourceKind.Metric:
          return s.toJSON({ getters: true });
        case SourceKind.Session:
          return s.toJSON({ getters: true });
        default:
          throw new Error(`Source found with invalid kind ${(s as any).kind}`);
      }
    });
    return res.json(out);
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({
    body: SourceSchemaNoId,
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      const source = await createSource(teamId.toString(), {
        ...req.body,
        team: teamId,
      });

      res.json(source);
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/:id',
  validateRequest({
    body: SourceSchema,
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);

      const source = await updateSource(teamId.toString(), req.params.id, {
        ...req.body,
        team: teamId,
      });

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
