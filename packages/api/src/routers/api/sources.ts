import { SourceSchema, SourceSchemaNoId } from '@berg/common-utils/dist/types';
import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { getTableSchema } from '@/controllers/catalog';
import {
  createSource,
  deleteSource,
  getSources,
  updateSource,
} from '@/controllers/sources';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { Source } from '@/models/source';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);

    const sources = await getSources(teamId.toString());

    return res.json(sources.map(source => source.toJSON({ getters: true })));
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
        team: teamId.toJSON(),
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
        team: teamId.toJSON(),
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

/**
 * Resolve a source's underlying table schema via Glue, scoped to the
 * requesting team.  This is the Berg replacement for the ClickHouse-era
 * `DESCRIBE` round-trip the chart-config emitter, Lucene parser and
 * filter-chip builder all relied on — those callers issued `DESCRIBE
 * db.table` against `system.tables`, which Berg deleted along with the
 * rest of the ClickHouse metadata layer.  We surface the same column
 * shape (`{ name, type }`) so the upstream code paths don't have to know
 * the data came from Glue.
 */
router.get(
  '/:id/columns',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
    query: z.object({
      database: z.string().min(1),
      table: z.string().min(1),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const source = await Source.findOne({
        _id: req.params.id,
        team: teamId,
      });
      if (!source) {
        return res
          .status(404)
          .json({ error: 'Source not found', code: 'not_found' });
      }
      if (!source.catalog) {
        return res
          .status(400)
          .json({ error: 'Source has no catalog configured' });
      }
      const schema = await getTableSchema(
        source.catalog,
        req.query.database,
        req.query.table,
      );
      return res.json({ columns: schema.columns });
    } catch (e) {
      const err = e as Error & { name?: string };
      if (err.name === 'EntityNotFoundException') {
        return res.status(404).json({ error: err.message, code: 'not_found' });
      }
      if (err.name === 'AccessDeniedException') {
        return res
          .status(403)
          .json({ error: err.message, code: 'access_denied' });
      }
      next(e);
    }
  },
);

export default router;
