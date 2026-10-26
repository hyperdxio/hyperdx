import express from 'express';
import { z } from 'zod';

import {
  KnowledgeError,
  type KnowledgeErrorCode,
  KnowledgeTargetError,
} from '@/knowledge/errors';
import Team from '@/models/team';

import incidentsRouter from './incidents';
import settingsRouter from './settings';

const router = express.Router();

const STATUS_BY_CODE = new Map<KnowledgeErrorCode, number>([
  ['not_found', 404],
  ['already_resolved', 409],
  ['not_resolved', 409],
  ['unknown_seq', 400],
  ['invalid', 400],
]);

router.use(async (req, res, next) => {
  try {
    const team = req.user?.team
      ? await Team.findById(req.user.team).select('isKnowledgeGraphEnabled')
      : null;
    if (!team?.isKnowledgeGraphEnabled) {
      return res.status(404).json({ message: 'Not found' });
    }
    return next();
  } catch (e) {
    return next(e);
  }
});

router.use('/settings', settingsRouter);
router.use('/incidents', incidentsRouter);

// Single place that maps knowledge errors to statuses; anything else falls
// through to the app error handler.
router.use(
  (
    err: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (err instanceof KnowledgeTargetError) {
      return res.status(412).json({ message: err.message });
    }
    if (err instanceof KnowledgeError) {
      return res
        .status(STATUS_BY_CODE.get(err.code) ?? 400)
        .json({ message: err.message });
    }
    if (err instanceof z.ZodError) {
      return res.status(400).json({ message: err.message });
    }
    return next(err);
  },
);

export default router;
