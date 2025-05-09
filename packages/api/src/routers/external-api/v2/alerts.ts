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

/**
 * @openapi
 * components:
 *   schemas:
 *     Error:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *     Alert:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           example: "65f5e4a3b9e77c001a123456"
 *         name:
 *           type: string
 *           example: "High Error Rate"
 *         message:
 *           type: string
 *           example: "Error rate exceeds threshold"
 *         threshold:
 *           type: number
 *           example: 100
 *         interval:
 *           type: string
 *           example: "15m"
 *         thresholdType:
 *           type: string
 *           enum: [above, below]
 *           example: "above"
 *         source:
 *           type: string
 *           enum: [tile, search]
 *           example: "tile"
 *         state:
 *           type: string
 *           example: "inactive"
 *         channel:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               example: "webhook"
 *             webhookId:
 *               type: string
 *               example: "65f5e4a3b9e77c001a789012"
 *         team:
 *           type: string
 *           example: "65f5e4a3b9e77c001a345678"
 *         tileId:
 *           type: string
 *           example: "65f5e4a3b9e77c001a901234"
 *         dashboard:
 *           type: string
 *           example: "65f5e4a3b9e77c001a567890"
 *         savedSearch:
 *           type: string
 *           nullable: true
 *         groupBy:
 *           type: string
 *           nullable: true
 *         silenced:
 *           type: boolean
 *           nullable: true
 *         createdAt:
 *           type: string
 *           format: date-time
 *           example: "2023-01-01T00:00:00.000Z"
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           example: "2023-01-01T00:00:00.000Z"
 *
 *     CreateAlertRequest:
 *       type: object
 *       required:
 *         - threshold
 *         - interval
 *         - source
 *         - thresholdType
 *         - channel
 *       properties:
 *         dashboardId:
 *           type: string
 *           example: "65f5e4a3b9e77c001a567890"
 *         tileId:
 *           type: string
 *           example: "65f5e4a3b9e77c001a901234"
 *         threshold:
 *           type: number
 *           example: 100
 *         interval:
 *           type: string
 *           example: "1h"
 *         source:
 *           type: string
 *           enum: [tile, search]
 *           example: "tile"
 *         thresholdType:
 *           type: string
 *           enum: [above, below]
 *           example: "above"
 *         channel:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               example: "webhook"
 *             webhookId:
 *               type: string
 *               example: "65f5e4a3b9e77c001a789012"
 *         name:
 *           type: string
 *           example: "Test Alert"
 *         message:
 *           type: string
 *           example: "Test Alert Message"
 *
 *     UpdateAlertRequest:
 *       type: object
 *       properties:
 *         threshold:
 *           type: number
 *           example: 500
 *         interval:
 *           type: string
 *           example: "1h"
 *         thresholdType:
 *           type: string
 *           enum: [above, below]
 *           example: "above"
 *         source:
 *           type: string
 *           enum: [tile, search]
 *           example: "tile"
 *         dashboardId:
 *           type: string
 *           example: "65f5e4a3b9e77c001a567890"
 *         tileId:
 *           type: string
 *           example: "65f5e4a3b9e77c001a901234"
 *         channel:
 *           type: object
 *           properties:
 *             type:
 *               type: string
 *               example: "webhook"
 *             webhookId:
 *               type: string
 *               example: "65f5e4a3b9e77c001a789012"
 *         name:
 *           type: string
 *           example: "Updated Alert Name"
 *         message:
 *           type: string
 *           example: "Updated message"
 *
 *     AlertResponse:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/Alert'
 *
 *     AlertsListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/Alert'
 *
 *     EmptyResponse:
 *       type: object
 *       properties: {}
 */

const router = express.Router();
/**
 * @openapi
 * /api/v2/alerts/{id}:
 *   get:
 *     summary: Get Alert
 *     description: Retrieves a specific alert by ID
 *     operationId: getAlert
 *     tags: [Alerts]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Alert ID
 *         example: "65f5e4a3b9e77c001a123456"
 *     responses:
 *       '200':
 *         description: Successfully retrieved alert
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AlertResponse'
 *             examples:
 *               alertResponse:
 *                 summary: Single alert response
 *                 value:
 *                   data:
 *                     id: "65f5e4a3b9e77c001a123456"
 *                     name: "CPU Usage Alert"
 *                     message: "CPU usage is above 80%"
 *                     threshold: 80
 *                     interval: "5m"
 *                     thresholdType: "above"
 *                     source: "tile"
 *                     state: "active"
 *                     channel:
 *                       type: "webhook"
 *                       webhookId: "65f5e4a3b9e77c001a789012"
 *                     team: "65f5e4a3b9e77c001a345678"
 *                     tileId: "65f5e4a3b9e77c001a901234"
 *                     dashboard: "65f5e4a3b9e77c001a567890"
 *                     createdAt: "2023-03-15T10:20:30.000Z"
 *                     updatedAt: "2023-03-15T14:25:10.000Z"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Alert not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/v2/alerts:
 *   get:
 *     summary: List Alerts
 *     description: Retrieves a list of all alerts for the authenticated team
 *     operationId: listAlerts
 *     tags: [Alerts]
 *     responses:
 *       '200':
 *         description: Successfully retrieved alerts
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AlertsListResponse'
 *             examples:
 *               alertsList:
 *                 summary: List of alerts
 *                 value:
 *                   data:
 *                     - id: "65f5e4a3b9e77c001a123456"
 *                       name: "High Error Rate"
 *                       message: "Error rate exceeds threshold"
 *                       threshold: 100
 *                       interval: "15m"
 *                       thresholdType: "above"
 *                       source: "tile"
 *                       state: "inactive"
 *                       channel:
 *                         type: "webhook"
 *                         webhookId: "65f5e4a3b9e77c001a789012"
 *                       team: "65f5e4a3b9e77c001a345678"
 *                       tileId: "65f5e4a3b9e77c001a901234"
 *                       dashboard: "65f5e4a3b9e77c001a567890"
 *                       createdAt: "2023-01-01T00:00:00.000Z"
 *                       updatedAt: "2023-01-01T00:00:00.000Z"
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 */
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

/**
 * @openapi
 * /api/v2/alerts:
 *   post:
 *     summary: Create Alert
 *     description: Creates a new alert
 *     operationId: createAlert
 *     tags: [Alerts]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateAlertRequest'
 *           examples:
 *             tileAlert:
 *               summary: Create a tile-based alert
 *               value:
 *                 dashboardId: "65f5e4a3b9e77c001a567890"
 *                 tileId: "65f5e4a3b9e77c001a901234"
 *                 threshold: 100
 *                 interval: "1h"
 *                 source: "tile"
 *                 thresholdType: "above"
 *                 channel:
 *                   type: "webhook"
 *                   webhookId: "65f5e4a3b9e77c001a789012"
 *                 name: "Error Spike Alert"
 *                 message: "Error rate has exceeded 100 in the last hour"
 *     responses:
 *       '200':
 *         description: Successfully created alert
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AlertResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Server error or validation failure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/v2/alerts/{id}:
 *   put:
 *     summary: Update Alert
 *     description: Updates an existing alert
 *     operationId: updateAlert
 *     tags: [Alerts]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Alert ID
 *         example: "65f5e4a3b9e77c001a123456"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateAlertRequest'
 *           examples:
 *             updateAlert:
 *               summary: Update alert properties
 *               value:
 *                 threshold: 500
 *                 interval: "1h"
 *                 thresholdType: "above"
 *                 source: "tile"
 *                 dashboardId: "65f5e4a3b9e77c001a567890"
 *                 tileId: "65f5e4a3b9e77c001a901234"
 *                 channel:
 *                   type: "webhook"
 *                   webhookId: "65f5e4a3b9e77c001a789012"
 *                 name: "Updated Alert Name"
 *                 message: "Updated threshold and interval"
 *     responses:
 *       '200':
 *         description: Successfully updated alert
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AlertResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Alert not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '500':
 *         description: Server error or validation failure
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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

/**
 * @openapi
 * /api/v2/alerts/{id}:
 *   delete:
 *     summary: Delete Alert
 *     description: Deletes an alert
 *     operationId: deleteAlert
 *     tags: [Alerts]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Alert ID
 *         example: "65f5e4a3b9e77c001a123456"
 *     responses:
 *       '200':
 *         description: Successfully deleted alert
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/EmptyResponse'
 *             example: {}
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Alert not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
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
