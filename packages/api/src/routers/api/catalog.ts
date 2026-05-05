/**
 * Glue Data Catalog discovery routes.
 *
 *   GET /catalogs
 *   GET /catalogs/:catalogId/databases
 *   GET /catalogs/:catalogId/databases/:database/tables
 *   GET /catalogs/:catalogId/databases/:database/tables/:table/schema
 *
 * Browse routes inherit the underlying client's "swallow AccessDenied,
 * return empty list" behaviour so partial-permissions IAM roles still see
 * a usable navigation tree.  The direct schema fetch surfaces both
 * `EntityNotFoundException` (404) and `AccessDeniedException` (403) as
 * real HTTP errors so the UI can distinguish "missing" from "hidden".
 */

import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  getTableSchema,
  listCatalogs,
  listDatabases,
  listTables,
} from '@/controllers/catalog';

const router = express.Router();

router.get('/catalogs', async (_req, res, next) => {
  try {
    res.json({ catalogs: await listCatalogs() });
  } catch (e) {
    next(e);
  }
});

router.get(
  '/catalogs/:catalogId/databases',
  validateRequest({ params: z.object({ catalogId: z.string().min(1) }) }),
  async (req, res, next) => {
    try {
      res.json({ databases: await listDatabases(req.params.catalogId) });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/catalogs/:catalogId/databases/:database/tables',
  validateRequest({
    params: z.object({
      catalogId: z.string().min(1),
      database: z.string().min(1),
    }),
  }),
  async (req, res, next) => {
    try {
      res.json({
        tables: await listTables(req.params.catalogId, req.params.database),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/catalogs/:catalogId/databases/:database/tables/:table/schema',
  validateRequest({
    params: z.object({
      catalogId: z.string().min(1),
      database: z.string().min(1),
      table: z.string().min(1),
    }),
  }),
  async (req, res, next) => {
    try {
      const schema = await getTableSchema(
        req.params.catalogId,
        req.params.database,
        req.params.table,
      );
      res.json(schema);
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
