import express from 'express';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import Alert from '@/models/alert';
import AlertHistory from '@/models/alertHistory';
import { getTeam } from '@/controllers/team';
import {
  createAlert,
  updateAlert,
  validateGroupByProperty,
} from '@/controllers/alerts';

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
    const alertHistories: any = {};
    for (const alert of alerts) {
      const histories = await AlertHistory.find({ alert: alert._id })
        .sort({ createdAt: -1 })
        .limit(20);
      alertHistories[alert._id.toString()] = histories;
    }
    res.json({
      data: {
        alerts: alerts,
        histories: alertHistories,
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
    const alertHistories = await AlertHistory.find({
      alert: id,
      team: teamId,
    }).limit(20);
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
