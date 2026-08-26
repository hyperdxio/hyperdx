import type {
  AlertApiResponse,
  AlertEvaluationsApiResponse,
  AlertHistoryRangeApiResponse,
  AlertsApiResponse,
  AlertsPageItem,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { pick } from 'lodash';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { processRequest, validateRequest } from 'zod-express-middleware';

import {
  getAlertEvaluations,
  getAlertTransitionsInRange,
  getRecentAlertHistories,
  getRecentAlertHistoriesBatch,
} from '@/controllers/alertHistory';
import {
  createAlert,
  deleteAlert,
  getAlertById,
  getAlertEnhanced,
  getAlertsEnhanced,
  updateAlert,
  validateAlertInput,
} from '@/controllers/alerts';
import { getAlertChannels } from '@/models/alert';
import { IAlertHistory } from '@/models/alertHistory';
import { PreSerialized, sendJson } from '@/utils/serialization';
import { internalAlertSchema, objectIdSchema } from '@/utils/zod';

const router = express.Router();

type EnhancedAlert = NonNullable<Awaited<ReturnType<typeof getAlertEnhanced>>>;

const formatAlertResponse = (
  alert: EnhancedAlert,
  history: Omit<IAlertHistory, 'alert'>[],
): PreSerialized<AlertsPageItem> => {
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
    // webhookId is included so edit surfaces (e.g. the alert detail page) can
    // prefill the notification channel; webhook ids are already visible to
    // team members via GET /webhooks.
    channel: pick(alert.channel, ['type', 'webhookId']),
    channels: getAlertChannels(alert).map(c => pick(c, ['type', 'webhookId'])),
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
    // Chart alerts carry their persisted config so edit surfaces can seed the
    // chart editor and the detail page can render the query.
    ...(alert.chartConfig && { chartConfig: alert.chartConfig }),
    ...pick(alert, [
      '_id',
      'interval',
      'scheduleOffsetMinutes',
      'scheduleStartAt',
      'threshold',
      'thresholdMax',
      'thresholdType',
      'state',
      'source',
      'name',
      'message',
      'note',
      'createdAt',
      'updatedAt',
      'executionErrors',
      'numConsecutiveWindows',
    ]),
    tileId: alert.tileId ?? undefined,
    groupBy: alert.groupBy ?? undefined,
  };
};

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
      return formatAlertResponse(alert, history);
    });

    sendJson(res, { data });
  } catch (e) {
    next(e);
  }
});

type AlertExpRes = express.Response<AlertApiResponse>;
router.get(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
  }),
  async (req, res: AlertExpRes, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const alert = await getAlertEnhanced(req.params.id, teamId);
      if (!alert) {
        return res.sendStatus(404);
      }

      const history = await getRecentAlertHistories({
        alertId: new ObjectId(alert._id),
        interval: alert.interval,
        limit: 20,
      });

      const data = formatAlertResponse(alert, history);

      sendJson(res, { data });
    } catch (e) {
      next(e);
    }
  },
);

// Alert history has a ~30-day TTL, so cap queried spans to bound the
// aggregations regardless of how small a startTime the caller sends.
const MAX_HISTORY_SPAN_MS = 31 * 24 * 60 * 60 * 1000;

// Paginated evaluation history for the alert detail page: one entry per
// evaluation window (grouped across group-by groups), newest first, including
// any errors recorded for the window. Scoped to [startTime, endTime] (epoch
// ms; endTime defaults to now, startTime is clamped to the history retention
// span). `before` (epoch ms, from the previous response's `nextBefore`) pages
// to older windows within the range. Note: /:id/history (below) returns
// firing transitions for chart annotations, which is a different shape.
const EVALUATIONS_LIMIT = 200;
type AlertEvaluationsExpRes = express.Response<AlertEvaluationsApiResponse>;
router.get(
  '/:id/evaluations',
  processRequest({
    params: z.object({ id: objectIdSchema }),
    query: z
      .object({
        limit: z.coerce
          .number()
          .int()
          .min(1)
          .max(EVALUATIONS_LIMIT)
          .default(EVALUATIONS_LIMIT),
        before: z.coerce.number().int().positive().optional(),
        startTime: z.coerce.number().int().positive().optional(),
        endTime: z.coerce.number().int().positive().optional(),
      })
      .refine(
        q =>
          q.startTime == null || q.endTime == null || q.startTime < q.endTime,
        { message: 'startTime must be less than endTime' },
      ),
  }),
  async (req, res: AlertEvaluationsExpRes, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      // Scope to the caller's team (404 for alerts they can't see).
      const alert = await getAlertById(req.params.id, teamId);
      if (!alert) {
        return res.sendStatus(404);
      }

      // zod applies the default at runtime, but the middleware types the
      // parsed query with the input (pre-default) shape.
      const limit = req.query.limit ?? EVALUATIONS_LIMIT;
      const { before } = req.query;
      const endTime =
        req.query.endTime != null ? new Date(req.query.endTime) : new Date();
      // Clamp the span so a tiny/zero startTime can't page beyond the history
      // retention window (same cap as the /history transitions endpoint).
      const startTime = new Date(
        Math.max(
          req.query.startTime ?? endTime.getTime() - MAX_HISTORY_SPAN_MS,
          endTime.getTime() - MAX_HISTORY_SPAN_MS,
        ),
      );

      const page = await getAlertEvaluations({
        alertId: new ObjectId(alert._id),
        interval: alert.interval,
        limit,
        startTime,
        endTime,
        before: before != null ? new Date(before) : undefined,
      });

      sendJson(res, {
        data: page.data,
        hasMore: page.hasMore,
        ...(page.nextBefore != null && {
          nextBefore: page.nextBefore.getTime(),
        }),
      });
    } catch (e) {
      next(e);
    }
  },
);

// Alert firing/recovery transitions within a time range, used to draw
// annotations on dashboard charts (startTime/endTime are epoch milliseconds).
type AlertHistoryRangeExpRes = express.Response<AlertHistoryRangeApiResponse>;
router.get(
  '/:id/history',
  processRequest({
    params: z.object({ id: objectIdSchema }),
    query: z
      .object({
        startTime: z.coerce.number().int(),
        endTime: z.coerce.number().int(),
      })
      .refine(q => q.startTime < q.endTime, {
        message: 'startTime must be less than endTime',
      }),
  }),
  async (req, res: AlertHistoryRangeExpRes, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      // Scope to the caller's team (404 for alerts they can't see). Uses the
      // populate-free lookup since we only need team ownership + interval.
      const alert = await getAlertById(req.params.id, teamId);
      if (!alert) {
        return res.sendStatus(404);
      }

      // Clamp the span so a tiny/zero startTime can't force a scan wider than
      // the history retention window.
      const startTime = Math.max(
        req.query.startTime,
        req.query.endTime - MAX_HISTORY_SPAN_MS,
      );

      const data = await getAlertTransitionsInRange({
        alertId: new ObjectId(alert._id),
        interval: alert.interval,
        startTime: new Date(startTime),
        endTime: new Date(req.query.endTime),
      });

      sendJson(res, { data });
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/',
  processRequest({ body: internalAlertSchema }),
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
    body: internalAlertSchema,
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
      const alert = await updateAlert(id, teamId, alertInput);
      if (alert == null) {
        return res.sendStatus(404);
      }
      return res.json({ data: alert });
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
