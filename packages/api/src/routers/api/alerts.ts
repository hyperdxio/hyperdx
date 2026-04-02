import type { AlertsApiResponse } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { pick } from 'lodash';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { processRequest, validateRequest } from 'zod-express-middleware';

import { getRecentAlertHistoriesBatch } from '@/controllers/alertHistory';
import {
  createAlert,
  deleteAlert,
  getAlertById,
  getAlertsEnhanced,
  updateAlert,
  validateAlertInput,
} from '@/controllers/alerts';
import { sendJson } from '@/utils/serialization';
import { alertSchema, objectIdSchema } from '@/utils/zod';

const router = express.Router();

type AlertsExpRes = express.Response<AlertsApiResponse>;
router.get('/', async (req, res: AlertsExpRes, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const alerts = await getAlertsEnhanced(teamId);

    const historyMap = await getRecentAlertHistoriesBatch(
      alerts.map(alert => ({
        alertId: new ObjectId(alert._id),
        interval: alert.interval,
      })),
      20,
    );

    const data = alerts.map(alert => {
      const history = historyMap.get(alert._id.toString()) ?? [];

      return {
        history,
        silenced: alert.silenced
          ? {
              by: alert.silenced.by?.email,
              at: alert.silenced.at,
              until: alert.silenced.until,
            }
          : undefined,
        createdBy: alert.createdBy
          ? pick(alert.createdBy, ['email', 'name'])
          : undefined,
        channel: pick(alert.channel, ['type']),
        ...(alert.dashboard && {
          dashboardId: alert.dashboard._id,
          dashboard: {
            tiles: alert.dashboard.tiles
              .filter(tile => tile.id === alert.tileId)
              .map(tile => ({
                id: tile.id,
                config: { name: tile.config.name },
              })),
            ...pick(alert.dashboard, ['_id', 'updatedAt', 'name', 'tags']),
          },
        }),
        ...(alert.savedSearch && {
          savedSearchId: alert.savedSearch._id,
          savedSearch: pick(alert.savedSearch, [
            '_id',
            'createdAt',
            'name',
            'updatedAt',
            'tags',
          ]),
        }),
        ...pick(alert, [
          '_id',
          'interval',
          'scheduleOffsetMinutes',
          'scheduleStartAt',
          'threshold',
          'thresholdType',
          'state',
          'source',
          'tileId',
          'createdAt',
          'updatedAt',
        ]),
      };
    });
    sendJson(res, { data });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  processRequest({ body: alertSchema }),
  async (req, res, next) => {
    const teamId = req.user?.team;
    const userId = req.user?._id;
    if (teamId == null || userId == null) {
      return res.sendStatus(403);
    }
    try {
      const alertInput = req.body;
      await validateAlertInput(teamId, alertInput);
      return res.json({
        data: await createAlert(teamId, alertInput, userId),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/:id',
  processRequest({
    body: alertSchema,
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
      const alertInput = req.body;
      await validateAlertInput(teamId, alertInput);
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
      mutedUntil: z
        .string()
        .datetime()
        .refine(val => new Date(val) > new Date(), {
          message: 'mutedUntil must be in the future',
        }),
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
        return res.status(404).json({ error: 'Alert not found' });
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
        return res.status(404).json({ error: 'Alert not found' });
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
