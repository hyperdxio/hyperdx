import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createSLO,
  deleteSLO,
  getSLO,
  getSLOBubbleUp,
  getSLOs,
  updateSLO,
} from '@/controllers/slo';
import { getSLOBurnRate, getSLOStatus } from '@/controllers/sloStatus';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { objectIdSchema, sloSchema } from '@/utils/zod';

const router = express.Router();

// Get all SLOs for a team
router.get('/', async (req, res, next) => {
  try {
    const { teamId } = getNonNullUserWithTeam(req);
    const slos = await getSLOs(teamId);
    return res.json(slos);
  } catch (e) {
    next(e);
  }
});

// Get a specific SLO
router.get(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id: sloId } = req.params;

      const slo = await getSLO(sloId, teamId);
      if (!slo) {
        return res.sendStatus(404);
      }

      return res.json(slo);
    } catch (e) {
      next(e);
    }
  },
);

// Get SLO status
router.get(
  '/:id/status',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id: sloId } = req.params;

      const status = await getSLOStatus(sloId, teamId);
      if (!status) {
        return res.sendStatus(404);
      }

      return res.json(status);
    } catch (e) {
      next(e);
    }
  },
);

// Get SLO burn rate
router.get(
  '/:id/burn-rate',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    query: z.object({
      timeStart: z.string().datetime(),
      timeEnd: z.string().datetime(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id: sloId } = req.params;
      const { timeStart, timeEnd } = req.query;

      const burnRate = await getSLOBurnRate(
        sloId,
        teamId,
        new Date(timeStart as string),
        new Date(timeEnd as string),
      );

      return res.json(burnRate);
    } catch (e) {
      next(e);
    }
  },
);

// Create a new SLO
router.post(
  '/',
  validateRequest({
    body: sloSchema,
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);

      const newSLO = await createSLO(teamId, req.body, userId);

      return res.json(newSLO);
    } catch (e) {
      next(e);
    }
  },
);

// Update an existing SLO
router.patch(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: sloSchema.partial(),
  }),
  async (req, res, next) => {
    try {
      const { teamId, userId } = getNonNullUserWithTeam(req);
      const { id: sloId } = req.params;

      const slo = await getSLO(sloId, teamId);
      if (!slo) {
        return res.sendStatus(404);
      }

      const updatedSLO = await updateSLO(sloId, teamId, req.body, userId);
      if (!updatedSLO) {
        return res.sendStatus(404);
      }

      return res.json(updatedSLO);
    } catch (e) {
      next(e);
    }
  },
);

// Delete an SLO
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
      const { id: sloId } = req.params;

      await deleteSLO(sloId, teamId);

      return res.sendStatus(204);
    } catch (e) {
      next(e);
    }
  },
);

// BubbleUp analysis
router.post(
  '/:id/bubbleup',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: z.object({
      timeStart: z.string().datetime(),
      timeEnd: z.string().datetime(),
    }),
  }),
  async (req, res, next) => {
    try {
      const { teamId } = getNonNullUserWithTeam(req);
      const { id: sloId } = req.params;
      const { timeStart, timeEnd } = req.body;

      const result = await getSLOBubbleUp(
        sloId,
        teamId,
        new Date(timeStart),
        new Date(timeEnd),
      );
      return res.json(result);
    } catch (e) {
      next(e);
    }
  },
);

export default router;

