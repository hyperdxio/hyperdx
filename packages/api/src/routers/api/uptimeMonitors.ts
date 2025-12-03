import express from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createUptimeMonitor,
  deleteUptimeMonitor,
  getUptimeCheckHistory,
  getUptimeMonitorById,
  getUptimeMonitors,
  getUptimeStats,
  pauseUptimeMonitor,
  resumeUptimeMonitor,
  updateUptimeMonitor,
} from '@/controllers/uptimeMonitors';
import {
  UptimeMonitorInterval,
  UptimeMonitorMethod,
} from '@/models/uptimeMonitor';
import { objectIdSchema } from '@/utils/zod';

const router = express.Router();

const uptimeMonitorSchema = z.object({
  name: z.string().min(1).max(255),
  url: z.string().url(),
  method: z.nativeEnum(UptimeMonitorMethod).optional(),
  interval: z.nativeEnum(UptimeMonitorInterval).optional(),
  timeout: z.number().min(1000).max(60000).optional(),
  notificationChannel: z
    .object({
      type: z.enum(['webhook']).nullable(),
      webhookId: z.string().optional(),
    })
    .optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  expectedStatusCodes: z.array(z.number()).optional(),
  expectedResponseTime: z.number().min(0).optional(),
  expectedBodyContains: z.string().optional(),
  verifySsl: z.boolean().optional(),
});

// Get all uptime monitors for the team
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const monitors = await getUptimeMonitors(teamId);

    res.json({
      data: monitors,
    });
  } catch (e) {
    next(e);
  }
});

// Get a specific uptime monitor
router.get(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { id } = req.params;
      const monitor = await getUptimeMonitorById(id, teamId);

      if (!monitor) {
        return res.status(404).json({ error: 'Monitor not found' });
      }

      res.json({
        data: monitor,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Create a new uptime monitor
router.post(
  '/',
  validateRequest({ body: uptimeMonitorSchema }),
  async (req, res, next) => {
    const teamId = req.user?.team;
    const userId = req.user?._id;
    if (teamId == null || userId == null) {
      return res.sendStatus(403);
    }
    try {
      const monitorInput = req.body;
      const monitor = await createUptimeMonitor(teamId, monitorInput, userId);
      return res.json({
        data: monitor,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Update an uptime monitor
router.put(
  '/:id',
  validateRequest({
    body: uptimeMonitorSchema,
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      const { id } = req.params;
      const monitorInput = req.body;
      const monitor = await updateUptimeMonitor(id, teamId, monitorInput);
      res.json({
        data: monitor,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Delete an uptime monitor
router.delete(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { id } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      if (!id) {
        return res.sendStatus(400);
      }

      await deleteUptimeMonitor(id, teamId);
      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  },
);

// Pause an uptime monitor
router.post(
  '/:id/pause',
  validateRequest({
    body: z.object({
      pausedUntil: z.string().datetime().optional(),
    }),
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const userId = req.user?._id;
      if (teamId == null || userId == null) {
        return res.sendStatus(403);
      }

      const { id } = req.params;
      const { pausedUntil } = req.body;

      const monitor = await pauseUptimeMonitor(
        id,
        teamId,
        userId,
        pausedUntil ? new Date(pausedUntil) : undefined,
      );

      if (!monitor) {
        return res.status(404).json({ error: 'Monitor not found' });
      }

      res.json({ data: monitor });
    } catch (e) {
      next(e);
    }
  },
);

// Resume an uptime monitor
router.post(
  '/:id/resume',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { id } = req.params;
      const monitor = await resumeUptimeMonitor(id, teamId);

      if (!monitor) {
        return res.status(404).json({ error: 'Monitor not found' });
      }

      res.json({ data: monitor });
    } catch (e) {
      next(e);
    }
  },
);

// Get check history for a monitor
router.get(
  '/:id/history',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    query: z.object({
      limit: z.string().optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { id } = req.params;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;

      const history = await getUptimeCheckHistory(id, teamId, limit);

      res.json({
        data: history,
      });
    } catch (e) {
      next(e);
    }
  },
);

// Get uptime stats for a monitor
router.get(
  '/:id/stats',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    query: z.object({
      startDate: z.string().datetime(),
      endDate: z.string().datetime(),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { id } = req.params;
      const { startDate, endDate } = req.query;

      const stats = await getUptimeStats(
        id,
        teamId,
        new Date(startDate as string),
        new Date(endDate as string),
      );

      res.json({
        data: stats,
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;

