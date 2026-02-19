import express from 'express';
import _ from 'lodash';
import { z } from 'zod';

import {
  createAlert,
  deleteAlert,
  getAlertById,
  getAlerts,
  updateAlert,
} from '@/controllers/alerts';
import { validateRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
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
 *     AlertInterval:
 *       type: string
 *       enum: [1m, 5m, 15m, 30m, 1h, 6h, 12h, 1d]
 *       description: Evaluation interval.
 *     AlertThresholdType:
 *       type: string
 *       enum: [above, below]
 *       description: Threshold comparison direction.
 *     AlertSource:
 *       type: string
 *       enum: [saved_search, tile]
 *       description: Alert source type.
 *     AlertState:
 *       type: string
 *       enum: [ALERT, OK, INSUFFICIENT_DATA, DISABLED]
 *       description: Current alert state.
 *     AlertChannelType:
 *       type: string
 *       enum: [webhook]
 *       description: Channel type.
 *     AlertSilenced:
 *       type: object
 *       description: Silencing metadata.
 *       properties:
 *         by:
 *           type: string
 *           description: User ID who silenced the alert.
 *           nullable: true
 *         at:
 *           type: string
 *           description: Silence start timestamp.
 *           format: date-time
 *         until:
 *           type: string
 *           description: Silence end timestamp.
 *           format: date-time
 *     AlertChannelWebhook:
 *       type: object
 *       required:
 *         - type
 *         - webhookId
 *       properties:
 *         type:
 *           $ref: '#/components/schemas/AlertChannelType'
 *         webhookId:
 *           type: string
 *           description: Webhook destination ID.
 *           example: "65f5e4a3b9e77c001a789012"
 *     AlertChannel:
 *       oneOf:
 *         - $ref: '#/components/schemas/AlertChannelWebhook'
 *       discriminator:
 *         propertyName: type
 *     Alert:
 *       type: object
 *       properties:
 *         dashboardId:
 *           type: string
 *           description: Dashboard ID for tile-based alerts.
 *           nullable: true
 *           example: "65f5e4a3b9e77c001a567890"
 *         tileId:
 *           type: string
 *           description: Tile ID for tile-based alerts.
 *           nullable: true
 *           example: "65f5e4a3b9e77c001a901234"
 *         savedSearchId:
 *           type: string
 *           description: Saved search ID for saved_search alerts.
 *           nullable: true
 *           example: "65f5e4a3b9e77c001a345678"
 *         groupBy:
 *           type: string
 *           description: Group-by key for saved search alerts.
 *           nullable: true
 *           example: "ServiceName"
 *         threshold:
 *           type: number
 *           description: Threshold value for triggering the alert.
 *           example: 100
 *         interval:
 *           $ref: '#/components/schemas/AlertInterval'
 *           example: "1h"
 *         source:
 *           $ref: '#/components/schemas/AlertSource'
 *           example: "tile"
 *         thresholdType:
 *           $ref: '#/components/schemas/AlertThresholdType'
 *           example: "above"
 *         channel:
 *           $ref: '#/components/schemas/AlertChannel'
 *           description: Alert notification channel configuration.
 *         name:
 *           type: string
 *           description: Human-friendly alert name.
 *           nullable: true
 *           example: "Test Alert"
 *         message:
 *           type: string
 *           description: Alert message template.
 *           nullable: true
 *           example: "Test Alert Message"
 *
 *     AlertResponse:
 *       allOf:
 *         - $ref: '#/components/schemas/Alert'
 *         - type: object
 *           properties:
 *             id:
 *               type: string
 *               description: Unique alert identifier.
 *               example: "65f5e4a3b9e77c001a123456"
 *             state:
 *               $ref: '#/components/schemas/AlertState'
 *               example: "ALERT"
 *             teamId:
 *               type: string
 *               description: Team identifier.
 *               example: "65f5e4a3b9e77c001a345678"
 *             silenced:
 *               $ref: '#/components/schemas/AlertSilenced'
 *               description: Silencing metadata.
 *               nullable: true
 *             createdAt:
 *               type: string
 *               nullable: true
 *               format: date-time
 *               description: Creation timestamp.
 *               example: "2023-01-01T00:00:00.000Z"
 *             updatedAt:
 *               type: string
 *               nullable: true
 *               format: date-time
 *               description: Last update timestamp.
 *               example: "2023-01-01T00:00:00.000Z"
 *
 *     CreateAlertRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/Alert'
 *         - type: object
 *           required:
 *             - threshold
 *             - interval
 *             - thresholdType
 *             - channel
 *
 *     UpdateAlertRequest:
 *       allOf:
 *         - $ref: '#/components/schemas/Alert'
 *         - type: object
 *           required:
 *             - threshold
 *             - interval
 *             - thresholdType
 *             - channel
 *
 *     AlertResponseEnvelope:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/AlertResponse'
 *
 *     AlertsListResponse:
 *       type: object
 *       properties:
 *         data:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AlertResponse'
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
 *               $ref: '#/components/schemas/AlertResponseEnvelope'
 *             examples:
 *               alertResponse:
 *                 summary: Single alert response
 *                 value:
 *                   data:
 *                     id: "65f5e4a3b9e77c001a123456"
 *                     threshold: 80
 *                     interval: "5m"
 *                     thresholdType: "above"
 *                     source: "tile"
 *                     state: "ALERT"
 *                     channel:
 *                       type: "webhook"
 *                       webhookId: "65f5e4a3b9e77c001a789012"
 *                     teamId: "65f5e4a3b9e77c001a345678"
 *                     tileId: "65f5e4a3b9e77c001a901234"
 *                     dashboardId: "65f5e4a3b9e77c001a567890"
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
 *                       threshold: 100
 *                       interval: "15m"
 *                       thresholdType: "above"
 *                       source: "tile"
 *                       state: "OK"
 *                       channel:
 *                         type: "webhook"
 *                         webhookId: "65f5e4a3b9e77c001a789012"
 *                       teamId: "65f5e4a3b9e77c001a345678"
 *                       tileId: "65f5e4a3b9e77c001a901234"
 *                       dashboardId: "65f5e4a3b9e77c001a567890"
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
 *               $ref: '#/components/schemas/AlertResponseEnvelope'
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
router.post(
  '/',
  validateRequest({
    body: alertSchema,
  }),
  async (req, res, next) => {
    const teamId = req.user?.team;
    const userId = req.user?._id;
    if (teamId == null || userId == null) {
      return res.sendStatus(403);
    }
    try {
      const alertInput = req.body;
      const createdAlert = await createAlert(teamId, alertInput, userId);

      return res.json({
        data: translateAlertDocumentToExternalAlert(createdAlert),
      });
    } catch (e) {
      next(e);
    }
  },
);

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
 *               $ref: '#/components/schemas/AlertResponseEnvelope'
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
