import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { Anomaly } from '@/models/anomaly';
import { getTeam } from '@/controllers/team';

const router = express.Router();

router.get(
  '/',
  validateRequest({
    query: z.object({
      serviceName: z.string().optional(),
      status: z.enum(['open', 'resolved', 'ignored']).optional(),
      limit: z.coerce.number().min(1).max(100).default(20),
      offset: z.coerce.number().min(0).default(0),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const { serviceName, status, limit, offset } = req.query;

      const query: any = { team: teamId };
      if (serviceName) query.serviceName = serviceName;
      if (status) query.status = status;

      const anomalies = await Anomaly.find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(offset);

      const total = await Anomaly.countDocuments(query);

      res.json({
        data: anomalies,
        meta: {
          total,
          limit,
          offset,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  '/:id',
  validateRequest({
    params: z.object({
      id: z.string(),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const anomaly = await Anomaly.findOne({
        _id: req.params.id,
        team: teamId,
      });

      if (!anomaly) {
        return res.sendStatus(404);
      }

      res.json({ data: anomaly });
    } catch (error) {
      next(error);
    }
  },
);

router.patch(
  '/:id',
  validateRequest({
    params: z.object({
      id: z.string(),
    }),
    body: z.object({
      status: z.enum(['open', 'resolved', 'ignored']),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (!teamId) {
        return res.sendStatus(403);
      }

      const anomaly = await Anomaly.findOneAndUpdate(
        { _id: req.params.id, team: teamId },
        { status: req.body.status },
        { new: true },
      );

      if (!anomaly) {
        return res.sendStatus(404);
      }

      res.json({ data: anomaly });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

