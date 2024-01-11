import express, { NextFunction, Request, Response } from 'express';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createAlert,
  updateAlert,
  validateGroupByProperty,
} from '@/controllers/alerts';
import { getTeam } from '@/controllers/team';
import Alert from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Dashboard, { IDashboard } from '@/models/dashboard';
import LogView, { ILogView } from '@/models/logView';

const router = express.Router();

// Input validation
const zChannel = z.object({
  type: z.literal('webhook'),
  webhookId: z.string().min(1),
});

const zLogAlert = z.object({
  source: z.literal('LOG'),
  groupBy: z.string().optional(),
  logViewId: z.string().min(1),
  message: z.string().optional(),
});

const zChartAlert = z.object({
  source: z.literal('CHART'),
  chartId: z.string().min(1),
  dashboardId: z.string().min(1),
});

const zAlert = z
  .object({
    channel: zChannel,
    interval: z.enum(['1m', '5m', '15m', '30m', '1h', '6h', '12h', '1d']),
    threshold: z.number().min(0),
    type: z.enum(['presence', 'absence']),
    source: z.enum(['LOG', 'CHART']).default('LOG'),
  })
  .and(zLogAlert.or(zChartAlert));

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

    // TODO: to use team field in the alert model
    const [dashboards, logViews] = await Promise.all([
      Dashboard.find({ team: teamId }, { _id: 1 }),
      LogView.find({ team: teamId }, { _id: 1 }),
    ]);

    const alerts = await Alert.find({
      $or: [
        {
          logView: {
            $in: logViews.map(logView => logView._id),
          },
        },
        {
          dashboardId: {
            $in: dashboards.map(dashboard => dashboard._id),
          },
        },
      ],
    }).populate<{
      logView: ILogView;
      dashboardId: IDashboard;
    }>(['logView', 'dashboardId']);

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
          channel: _.pick(alert.channel, ['type']),
          ...(alert.dashboardId && {
            dashboard: {
              charts: alert.dashboardId.charts
                .filter(chart => chart.id === alert.chartId)
                .map(chart => _.pick(chart, ['id', 'name'])),
              ..._.pick(alert.dashboardId, ['_id', 'name', 'updatedAt']),
            },
          }),
          ...(alert.logView && {
            logView: _.pick(alert.logView, [
              '_id',
              'createdAt',
              'name',
              'updatedAt',
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
  validateRequest({ body: zAlert }),
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
  validateRequest({ body: zAlert }),
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

router.delete('/:id', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { id: alertId } = req.params;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    if (!alertId) {
      return res.sendStatus(400);
    }
    // FIXME: should add teamId to the find query
    await Alert.findByIdAndDelete(alertId);
    res.sendStatus(200);
  } catch (e) {
    next(e);
  }
});

export default router;
