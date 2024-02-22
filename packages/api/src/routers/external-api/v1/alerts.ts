import express, { NextFunction, Request, Response } from 'express';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createAlert,
  deleteAlert,
  getAlertById,
  getAlerts,
  updateAlert,
  validateGroupByProperty,
} from '@/controllers/alerts';
import { getTeam } from '@/controllers/team';
import {
  externalAlertSchema,
  objectIdSchema,
  translateAlertDocumentToExternalAlert,
  translateExternalAlertToInternalAlert,
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

      const alert = await getAlertById(req.params.id, teamId);

      if (alert == null) {
        return res.sendStatus(404);
      }

      return res.json({
        data: translateAlertDocumentToExternalAlert(alert),
      });
    } catch (e) {
      next(e);
    }
  },
);

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
