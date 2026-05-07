/**
 * Query lifecycle routes — `POST /` to run, `GET /:id/status`,
 * `GET /:id/results`, `DELETE /:id`.
 *
 * The trust boundary lives at the router level: every route is auth-gated
 * by the parent `app.use('/api/v1/query', isUserAuthenticated, ...)` and
 * the start path additionally enforces team ownership of any provided
 * `sourceId`.  There is no SQL pass-through endpoint — every query has to
 * cross this gate.
 */

import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  cancelQuery,
  getQueryResults,
  getQueryStatus,
  startQuery,
} from '@/controllers/query';
import { getNonNullUserWithTeam } from '@/middleware/auth';

const router = express.Router();

router.post(
  '/',
  validateRequest({
    body: z.object({
      sql: z.string().min(1),
      sourceId: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const result = await startQuery({
        sql: req.body.sql,
        teamId: teamId.toString(),
        sourceId: req.body.sourceId,
      });
      res.json(result);
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'forbidden_write') {
        return res
          .status(403)
          .json({ error: err.message, code: 'forbidden_write' });
      }
      if (err.code === 'source_not_found') {
        return res
          .status(404)
          .json({ error: err.message, code: 'source_not_found' });
      }
      // Athena error code mapping — surface user errors at sensible HTTP
      // statuses instead of a generic 500.
      switch (err.code) {
        case 'access_denied':
          return res.status(403).json({ error: err.message, code: err.code });
        case 'syntax_error':
        case 'column_not_found':
          return res.status(400).json({ error: err.message, code: err.code });
        case 'table_not_found':
          return res.status(404).json({ error: err.message, code: err.code });
        case 'throttled':
          return res.status(429).json({ error: err.message, code: err.code });
        case 'unknown':
          // `classifyAthenaError` puts everything it can't bucket into
          // 'unknown' — that includes legitimate user errors like
          // `FUNCTION_NOT_FOUND` and `INVALID_FUNCTION_ARGUMENT`.
          // Returning 400 with the original Athena message is far more
          // useful than the appErrorHandler's generic
          // "Something went wrong :(".
          return res.status(400).json({ error: err.message, code: err.code });
        default:
          break;
      }
      next(e);
    }
  },
);

router.get(
  '/:id/status',
  validateRequest({ params: z.object({ id: z.string().min(1) }) }),
  async (req, res, next) => {
    try {
      res.json({ status: await getQueryStatus(req.params.id) });
    } catch (e) {
      next(e);
    }
  },
);

router.get(
  '/:id/results',
  validateRequest({
    params: z.object({ id: z.string().min(1) }),
    query: z.object({ nextToken: z.string().optional() }),
  }),
  async (req, res, next) => {
    try {
      const nextToken =
        typeof req.query.nextToken === 'string'
          ? req.query.nextToken
          : undefined;
      res.json(await getQueryResults(req.params.id, nextToken));
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: z.string().min(1) }) }),
  async (req, res, next) => {
    try {
      await cancelQuery(req.params.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
