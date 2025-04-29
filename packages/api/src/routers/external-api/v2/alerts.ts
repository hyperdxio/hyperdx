import express from 'express';
import _ from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import {
  createAlert,
  deleteAlert,
  getAlertById,
  getAlerts,
  updateAlert,
} from '@/controllers/alerts';
import { translateAlertDocumentToExternalAlert } from '@/utils/externalApi';
import { alertSchema, objectIdSchema } from '@/utils/zod';

const router = express.Router();

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
      data: alerts.map(alert => translateAlertDocumentToExternalAlert(alert)),
    });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  const teamId = req.user?.team;
  if (teamId == null) {
    return res.sendStatus(403);
  }
  try {
    const alertInput = req.body;
    const createdAlert = await createAlert(teamId, alertInput);

    return res.json({
      data: translateAlertDocumentToExternalAlert(createdAlert),
    });
  } catch (e) {
    next(e);
  }
});

router.put(
  '/:id',
  validateRequest({
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
      const alert = await updateAlert(id, teamId, alertInput);

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
