import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createAlert,
  updateAlert,
  validateGroupByProperty,
} from '@/controllers/alerts';
import { getTeam } from '@/controllers/team';
import Alert, { IAlert } from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import Dashboard from '@/models/dashboard';
import LogView from '@/models/logView';

const router = express.Router();

// Input validation
const zChannel = z.object({
  type: z.literal('webhook'),
  webhookId: z.string().min(1),
});

const validateGet = validateRequest({ params: z.object({ id: z.string() }) });

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
    threshold: z.number().min(1),
    type: z.enum(['presence', 'absence']),
    source: z.enum(['LOG', 'CHART']).default('LOG'),
  })
  .and(zLogAlert.or(zChartAlert));

const zAlertInput = zAlert;

const getHistory = async (alert: IAlert, teamId: string) => {
  const histories = await AlertHistory.find({ alert: alert._id, team: teamId })
    .sort({ createdAt: -1 })
    .limit(20);
  return histories;
};

const getDashboard = async (alert: IAlert, teamId: string) => {
  const dashboard = await Dashboard.findOne({
    _id: alert.dashboardId,
    team: teamId,
  });
  return dashboard;
};

const getLogView = async (alert: IAlert, teamId: string) => {
  const logView = await LogView.findOne({
    _id: alert.logView,
    team: teamId,
  });
  return logView;
};

// Validate groupBy property
const validateGroupBy = async (req, res, next) => {
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

// Routes
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    const alerts = await Alert.find({ team: teamId });
    const alertsWithHistory = await Promise.all(
      alerts.map(async alert => {
        if (!alert.source) throw new Error('Alert source is undefined');
        if (alert.source === 'LOG') {
          return {
            alert: alert,
            logView: await getLogView(alert, teamId.toString()),
            history: await getHistory(alert, teamId.toString()),
          };
        } else {
          return {
            alert: alert,
            dashboard: await getDashboard(alert, teamId.toString()),
            history: await getHistory(alert, teamId.toString()),
          };
        }
      }),
    );
    res.json({
      data: {
        alerts: alertsWithHistory,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.get('/:id', validateGet, async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    const { id } = req.params;
    const alert = await Alert.findOne({ _id: id, team: teamId });
    if (!alert) {
      return res.sendStatus(404);
    }
    const alertHistories = await getHistory(alert, teamId.toString());
    res.json({
      data: {
        ...alert,
        history: alertHistories,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({ body: zAlertInput }),
  validateGroupBy,
  async (req, res, next) => {
    try {
      const alertInput = req.body;
      return res.json({
        data: await createAlert(alertInput),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.put(
  '/:id',
  validateRequest({ body: zAlertInput }),
  validateGroupBy,
  async (req, res, next) => {
    try {
      const { id } = req.params;
      const alertInput = req.body;
      res.json({
        data: await updateAlert(id, alertInput),
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
    await Alert.findByIdAndDelete(alertId);
    res.sendStatus(200);
  } catch (e) {
    next(e);
  }
});

export default router;
