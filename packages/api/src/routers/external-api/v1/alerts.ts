import express, { NextFunction, Request, Response } from 'express';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createAlert,
  deleteAlert,
  getAlerts,
  updateAlert,
  validateGroupByProperty,
} from '@/controllers/alerts';
import { getTeam } from '@/controllers/team';
import { AlertDocument } from '@/models/alert';
import {
  alertSchema,
  externalAlertSchema,
  externalAlertSchemaWithId,
  objectIdSchema,
} from '@/utils/zod';

const router = express.Router();

// TODO: Dedup with private API router
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

const translateExternalAlertToInternalAlert = (
  alertInput: z.infer<typeof externalAlertSchema>,
): z.infer<typeof alertSchema> => {
  return {
    interval: alertInput.interval,
    threshold: alertInput.threshold,
    type: alertInput.threshold_type === 'above' ? 'presence' : 'absence',
    channel: {
      ...alertInput.channel,
      type: 'webhook',
    },
    ...(alertInput.source === 'search' && alertInput.savedSearchId
      ? { source: 'LOG', logViewId: alertInput.savedSearchId }
      : alertInput.source === 'chart' && alertInput.dashboardId
      ? {
          source: 'CHART',
          dashboardId: alertInput.dashboardId,
          chartId: alertInput.chartId,
        }
      : ({} as never)),
  };
};

const translateAlertDocumentToExternalAlert = (
  alertDoc: AlertDocument,
): z.infer<typeof externalAlertSchemaWithId> => {
  return {
    id: alertDoc._id.toString(),
    interval: alertDoc.interval,
    threshold: alertDoc.threshold,
    threshold_type: alertDoc.type === 'absence' ? 'below' : 'above',
    channel: {
      ...alertDoc.channel,
      type: 'slack_webhook',
    },
    ...(alertDoc.source === 'LOG' && alertDoc.logView
      ? { source: 'search', savedSearchId: alertDoc.logView.toString() }
      : alertDoc.source === 'CHART' && alertDoc.dashboardId
      ? {
          source: 'chart',
          dashboardId: alertDoc.dashboardId.toString(),
          chartId: alertDoc.chartId as string,
        }
      : ({} as never)),
  };
};

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const alerts = await getAlerts(teamId);

    return res.json({
      data: alerts.map(alert => {
        return translateAlertDocumentToExternalAlert(alert);
      }),
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({ body: externalAlertSchema }),
  validateGroupBy,
  async (req, res, next) => {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    try {
      const alertInput = req.body;

      const internalAlert = translateExternalAlertToInternalAlert(alertInput);

      return res.json({
        data: translateAlertDocumentToExternalAlert(
          await createAlert(teamId, internalAlert),
        ),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/:id',
  validateRequest({
    body: externalAlertSchema,
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
      const internalAlert = translateExternalAlertToInternalAlert(alertInput);
      const alert = await updateAlert(id, teamId, internalAlert);

      if (alert == null) {
        return res.sendStatus(404);
      }

      res.json({
        data: translateAlertDocumentToExternalAlert(alert),
      });
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

      await deleteAlert(alertId, teamId);
      res.sendStatus(200);
    } catch (e) {
      next(e);
    }
  },
);

export default router;
