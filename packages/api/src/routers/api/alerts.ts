import type { AlertsApiResponse } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { processRequest, validateRequest } from 'zod-express-middleware';

import { getRecentAlertHistories } from '@/controllers/alertHistory';
import {
  createAlert,
  deleteAlert,
  getAlertById,
  getAlertsEnhanced,
  updateAlert,
  validateAlertInput,
} from '@/controllers/alerts';
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

    const data: AlertsApiResponse['data'] = await Promise.all(
      alerts.map(async alert => {
        const history = await getRecentAlertHistories({
          alertId: new ObjectId(alert._id),
          interval: alert.interval,
          limit: 20,
        });

        return {
          _id: alert._id.toString(),
          interval: alert.interval,
          scheduleOffsetMinutes: alert.scheduleOffsetMinutes,
          scheduleStartAt: alert.scheduleStartAt?.toISOString() ?? undefined,
          threshold: alert.threshold,
          thresholdType: alert.thresholdType,
          conditionType: alert.conditionType,
          changeType: alert.changeType,
          channel: { type: alert.channel.type ?? undefined },
          state: alert.state,
          source: alert.source,
          tileId: alert.tileId,
          name: alert.name,
          message: alert.message,
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          createdAt: (alert as any).createdAt?.toISOString?.() ?? '',
          // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
          updatedAt: (alert as any).updatedAt?.toISOString?.() ?? '',
          history: history.map(h => ({
            counts: h.counts,
            createdAt: h.createdAt.toISOString(),
            state: h.state,
            lastValues: h.lastValues.map(lv => ({
              startTime: lv.startTime.toISOString(),
              count: lv.count,
            })),
          })),
          silenced: alert.silenced
            ? {
                by: alert.silenced.by?.email ?? '',
                at: alert.silenced.at.toISOString(),
                until: alert.silenced.until.toISOString(),
              }
            : undefined,
          createdBy: alert.createdBy
            ? {
                email: alert.createdBy.email,
                name: alert.createdBy.name,
              }
            : undefined,
          dashboardId: alert.dashboard
            ? alert.dashboard._id.toString()
            : undefined,
          savedSearchId: alert.savedSearch
            ? alert.savedSearch._id.toString()
            : undefined,
          dashboard: alert.dashboard
            ? {
                _id: alert.dashboard._id.toString(),
                name: alert.dashboard.name,
                updatedAt:
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  (alert as any).dashboard?.updatedAt?.toISOString?.() ?? '',
                tags: alert.dashboard.tags,
                tiles: alert.dashboard.tiles
                  .filter(tile => tile.id === alert.tileId)
                  .map(tile => ({
                    id: tile.id,
                    config: { name: tile.config.name },
                  })),
              }
            : undefined,
          savedSearch: alert.savedSearch
            ? {
                _id: alert.savedSearch._id.toString(),
                createdAt:
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  (alert as any).savedSearch?.createdAt?.toISOString?.() ?? '',
                name: alert.savedSearch.name,
                updatedAt:
                  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
                  (alert as any).savedSearch?.updatedAt?.toISOString?.() ?? '',
                tags: alert.savedSearch.tags,
              }
            : undefined,
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
