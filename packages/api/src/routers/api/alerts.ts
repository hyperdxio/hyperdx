import type {
  AlertApiResponse,
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
  getAlertTransitionsInRange,
  getRecentAlertGroupSummaries,
  getRecentAlertGroupSummariesBatch,
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
import { IAlertHistory } from '@/models/alertHistory';
import { PreSerialized, sendJson } from '@/utils/serialization';
import { alertSchema, objectIdSchema } from '@/utils/zod';

const router = express.Router();

type EnhancedAlert = NonNullable<Awaited<ReturnType<typeof getAlertEnhanced>>>;
type AlertGroupSummary = Awaited<
  ReturnType<typeof getRecentAlertGroupSummaries>
>[number];
type AlertResponseGroupBy = string | string[];

const futureMutedUntilSchema = z
  .string()
  .datetime()
  .refine(val => new Date(val) > new Date(), {
    message: 'mutedUntil must be in the future',
  });

const groupSchema = z.string().refine(value => value.trim().length > 0, {
  message: 'group must not be empty',
});

const getGroupByValueExpression = (
  groupBy: unknown,
): AlertResponseGroupBy | undefined => {
  if (typeof groupBy === 'string') {
    const trimmedGroupBy = groupBy.trim();
    return trimmedGroupBy.length > 0 ? trimmedGroupBy : undefined;
  }

  if (Array.isArray(groupBy)) {
    const groupByValues = groupBy
      .map(value => {
        if (typeof value === 'string') {
          return value;
        }
        if (
          value != null &&
          typeof value === 'object' &&
          'valueExpression' in value &&
          typeof value.valueExpression === 'string'
        ) {
          return value.valueExpression;
        }
        return undefined;
      })
      .filter((value): value is string => value != null && value.length > 0);

    return groupByValues.length > 0 ? groupByValues : undefined;
  }

  return undefined;
};

const getConfiguredAlertGroupBy = (
  alert: EnhancedAlert,
): AlertResponseGroupBy | undefined => {
  const alertGroupBy = getGroupByValueExpression(alert.groupBy);
  if (alertGroupBy != null) {
    return alertGroupBy;
  }

  const tile = alert.dashboard?.tiles.find(tile => tile.id === alert.tileId);
  if (tile?.config != null && 'groupBy' in tile.config) {
    return getGroupByValueExpression(tile.config.groupBy);
  }

  return undefined;
};

const formatAlertResponse = (
  alert: EnhancedAlert,
  history: Omit<IAlertHistory, 'alert'>[],
  groups?: AlertGroupSummary[],
): PreSerialized<AlertsPageItem> => {
  const formattedGroups = groups?.map(groupSummary => {
    const groupSilence = alert.silencedGroups?.find(
      silencedGroup => silencedGroup.group === groupSummary.group,
    );
    const groupUnsilence = alert.unsilencedGroups?.find(
      unsilencedGroup => unsilencedGroup.group === groupSummary.group,
    );

    return {
      group: groupSummary.group,
      state: groupSummary.state,
      history: groupSummary.history,
      silenced: groupSilence
        ? {
            by: groupSilence.by?.email,
            at: groupSilence.at,
            until: groupSilence.until,
          }
        : undefined,
      unsilenced: groupUnsilence
        ? {
            by: groupUnsilence.by?.email,
            at: groupUnsilence.at,
            parentSilencedAt: groupUnsilence.parentSilencedAt,
          }
        : undefined,
    };
  });

  return {
    history,
    groupBy: getConfiguredAlertGroupBy(alert),
    groups: formattedGroups,
    silenced: alert.silenced
      ? {
          by: alert.silenced.by?.email,
          at: alert.silenced.at,
          until: alert.silenced.until,
        }
      : undefined,
    silencedGroups: alert.silencedGroups?.map(groupSilence => ({
      group: groupSilence.group,
      by: groupSilence.by?.email,
      at: groupSilence.at,
      until: groupSilence.until,
    })),
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
      'thresholdMax',
      'thresholdType',
      'state',
      'source',
      'tileId',
      'note',
      'createdAt',
      'updatedAt',
      'executionErrors',
      'numConsecutiveWindows',
    ]),
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
    const groupSummaryMap = await getRecentAlertGroupSummariesBatch(
      alerts.map(alert => ({
        alertId: new ObjectId(alert._id),
        interval: alert.interval,
      })),
      20,
    );

    const data = alerts.map(alert => {
      const history = historyMap.get(alert._id.toString()) ?? [];
      const groups = groupSummaryMap.get(alert._id.toString());
      return formatAlertResponse(alert, history, groups);
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
      const groups = await getRecentAlertGroupSummaries({
        alertId: new ObjectId(alert._id),
        interval: alert.interval,
        limit: 20,
      });

      const data = formatAlertResponse(alert, history, groups);

      sendJson(res, { data });
    } catch (e) {
      next(e);
    }
  },
);

// Alert firing/recovery transitions within a time range, used to draw
// annotations on dashboard charts (startTime/endTime are epoch milliseconds).
// Alert history has a ~30-day TTL, so cap the queried span to bound the
// aggregation regardless of how small a startTime the caller sends.
const MAX_HISTORY_SPAN_MS = 31 * 24 * 60 * 60 * 1000;
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
  '/:id/group-silenced',
  validateRequest({
    body: z.object({
      group: groupSchema,
      mutedUntil: futureMutedUntilSchema,
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

      const silencedGroup = {
        group: req.body.group,
        by: req.user._id,
        at: new Date(),
        until: new Date(req.body.mutedUntil),
      };

      alert.silencedGroups = [
        ...(alert.silencedGroups?.filter(
          groupSilence => groupSilence.group !== req.body.group,
        ) ?? []),
        silencedGroup,
      ];
      alert.unsilencedGroups = alert.unsilencedGroups?.filter(
        groupUnsilence => groupUnsilence.group !== req.body.group,
      );
      if (alert.unsilencedGroups?.length === 0) {
        alert.unsilencedGroups = undefined;
      }
      await alert.save();

      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/group-unsilenced',
  validateRequest({
    body: z.object({
      group: groupSchema,
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
      if (
        alert.silenced == null ||
        alert.silenced.until.getTime() <= Date.now()
      ) {
        return res.status(400).json({
          error: 'Alert must have an active acknowledgment',
        });
      }

      const unsilencedGroup = {
        group: req.body.group,
        by: req.user._id,
        at: new Date(),
        parentSilencedAt: alert.silenced.at,
      };

      alert.silencedGroups = alert.silencedGroups?.filter(
        groupSilence => groupSilence.group !== req.body.group,
      );
      if (alert.silencedGroups?.length === 0) {
        alert.silencedGroups = undefined;
      }
      alert.unsilencedGroups = [
        ...(alert.unsilencedGroups?.filter(
          groupUnsilence => groupUnsilence.group !== req.body.group,
        ) ?? []),
        unsilencedGroup,
      ];
      await alert.save();

      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/group-unsilenced',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    query: z.object({
      group: groupSchema,
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

      alert.unsilencedGroups = alert.unsilencedGroups?.filter(
        groupUnsilence => groupUnsilence.group !== req.query.group,
      );
      if (alert.unsilencedGroups?.length === 0) {
        alert.unsilencedGroups = undefined;
      }
      await alert.save();

      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  },
);

router.delete(
  '/:id/group-silenced',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    query: z.object({
      group: groupSchema,
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

      alert.silencedGroups = alert.silencedGroups?.filter(
        groupSilence => groupSilence.group !== req.query.group,
      );
      if (alert.silencedGroups?.length === 0) {
        alert.silencedGroups = undefined;
      }
      await alert.save();

      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  },
);

router.post(
  '/:id/silenced',
  validateRequest({
    body: z.object({
      mutedUntil: futureMutedUntilSchema,
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
      alert.unsilencedGroups = undefined;
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
      alert.unsilencedGroups = undefined;
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
