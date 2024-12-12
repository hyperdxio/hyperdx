import express, { NextFunction, Request, Response } from 'express';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createAlert,
  deleteAlert,
  getAlertById,
  getAlertsEnhanced,
  updateAlert,
  validateGroupByProperty,
} from '@/controllers/alerts';
import { getTeam } from '@/controllers/team';
import AlertHistory from '@/models/alertHistory';
import { alertSchema, objectIdSchema } from '@/utils/zod';

const router = express.Router();

// Validate groupBy property
const validateGroupBy = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const { groupBy, source } = req.body || {};
  if (source === 'LOG' && groupBy) {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    const team = await getTeam(teamId);
    if (team == null) {
      return res.sendStatus(403);
    }
    // Validate groupBy property
    const groupByValid = await validateGroupByProperty({
      groupBy,
      logStreamTableVersion: team.logStreamTableVersion,
      teamId: teamId.toString(),
    });
    if (!groupByValid) {
      return res.status(400).json({
        error: 'Invalid groupBy property',
      });
    }
  }
  next();
};

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const alerts = await getAlertsEnhanced(teamId);

    const data = await Promise.all(
      alerts.map(async alert => {
        const history = await AlertHistory.find(
          {
            alert: alert._id,
          },
          {
            __v: 0,
            _id: 0,
            alert: 0,
          },
        )
          .sort({ createdAt: -1 })
          .limit(20);

        return {
          history,
          silenced: alert.silenced
            ? {
                by: alert.silenced.by?.email,
                at: alert.silenced.at,
                until: alert.silenced.until,
              }
            : undefined,
          channel: _.pick(alert.channel, ['type']),
          ...(alert.dashboardId && {
            dashboard: {
              charts: alert.dashboardId.tiles
                .filter(chart => chart.id === alert.tileId)
                .map(chart => _.pick(chart, ['id', 'name'])),
              ..._.pick(alert.dashboardId, [
                '_id',
                'name',
                'updatedAt',
                'tags',
              ]),
            },
          }),
          ...(alert.savedSearch && {
            savedSearch: _.pick(alert.savedSearch, [
              '_id',
              'createdAt',
              'name',
              'updatedAt',
              'tags',
            ]),
          }),
          ..._.pick(alert, [
            '_id',
            'interval',
            'threshold',
            'state',
            'type',
            'source',
            'chartId',
            'createdAt',
            'updatedAt',
          ]),
        };
      }),
    );
    res.json({
      data,
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({ body: alertSchema }),
  validateGroupBy,
  async (req, res, next) => {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    try {
      const alertInput = req.body;
      return res.json({
        data: await createAlert(teamId, alertInput),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/:id',
  validateRequest({
    body: alertSchema,
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  validateGroupBy,
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      const { id } = req.params;
      const alertInput = req.body;
      res.json({
        data: await updateAlert(id, teamId, alertInput),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/silenced',
  validateRequest({
    body: z.object({
      mutedUntil: z.string().datetime(),
    }),
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null || req.user == null) {
        return res.sendStatus(403);
      }

      const alert = await getAlertById(req.params.id, teamId);
      if (!alert) {
        throw new Error('Alert not found');
      }
      alert.silenced = {
        by: req.user._id,
        at: new Date(),
        until: new Date(req.body.mutedUntil),
      };
      await alert.save();

      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/silenced',
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

      const alert = await getAlertById(req.params.id, teamId);
      if (!alert) {
        throw new Error('Alert not found');
      }
      alert.silenced = undefined;
      await alert.save();

      res.sendStatus(200);
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
      const teamId = req.user?.team;
      const { id: alertId } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      if (!alertId) {
        return res.sendStatus(400);
      }

      await deleteAlert(alertId, teamId);
      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
