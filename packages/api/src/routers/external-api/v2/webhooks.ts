import express from 'express';

import { WebhookDocument } from '@/models/webhook';
import Webhook from '@/models/webhook';
import logger from '@/utils/logger';
import { ExternalWebhook, externalWebhookSchema } from '@/utils/zod';

function formatExternalWebhook(
  webhook: WebhookDocument,
): ExternalWebhook | undefined {
  // Convert to JSON so that any ObjectIds are converted to strings ("_id" is also converted to "id")
  const json = JSON.stringify(webhook.toJSON({ getters: true }));

  // Parse using the externalWebhookSchema to strip out any fields not defined in the schema
  const parseResult = externalWebhookSchema.safeParse(JSON.parse(json));
  if (parseResult.success) {
    return parseResult.data;
  }

  // If parsing fails, log the error and return undefined
  logger.error(
    { webhook, error: parseResult.error },
    'Failed to parse webhook using externalWebhookSchema:',
  );

  return undefined;
}

/**
 * @openapi
 * components:
 *   schemas:
 *     SlackWebhook:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - service
 *         - updatedAt
 *         - createdAt
 *       properties:
 *         id:
 *           type: string
 *           description: Webhook ID
 *           example: 507f1f77bcf86cd799439011
 *         name:
 *           type: string
 *           description: Webhook name
 *           example: Production Alerts
 *         service:
 *           type: string
 *           enum: [slack]
 *           description: Webhook service type
 *           example: slack
 *         url:
 *           type: string
 *           description: Slack incoming webhook URL
 *           example: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
 *         description:
 *           type: string
 *           description: Webhook description, shown in the UI
 *           example: Sends critical alerts to the #incidents channel
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *           example: "2025-06-15T10:30:00.000Z"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *           example: "2025-01-01T00:00:00.000Z"
 *     IncidentIOWebhook:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - service
 *         - updatedAt
 *         - createdAt
 *       properties:
 *         id:
 *           type: string
 *           description: Webhook ID
 *           example: 507f1f77bcf86cd799439012
 *         name:
 *           type: string
 *           description: Webhook name
 *           example: Incident Response
 *         service:
 *           type: string
 *           enum: [incidentio]
 *           description: Webhook service type
 *           example: incidentio
 *         url:
 *           type: string
 *           description: incident.io alert event HTTP source URL
 *           example: https://api.incident.io/v2/alert_events/http/abc123
 *         description:
 *           type: string
 *           description: Webhook description, shown in the UI
 *           example: Routes alerts to incident.io for on-call escalation
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *           example: "2025-06-15T10:30:00.000Z"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *           example: "2025-01-01T00:00:00.000Z"
 *     GenericWebhook:
 *       type: object
 *       required:
 *         - id
 *         - name
 *         - service
 *         - updatedAt
 *         - createdAt
 *       properties:
 *         id:
 *           type: string
 *           description: Webhook ID
 *           example: 507f1f77bcf86cd799439013
 *         name:
 *           type: string
 *           description: Webhook name
 *           example: PagerDuty Integration
 *         service:
 *           type: string
 *           enum: [generic]
 *           description: Webhook service type
 *           example: generic
 *         url:
 *           type: string
 *           description: Webhook destination URL
 *           example: https://example.com/webhooks/alerts
 *         description:
 *           type: string
 *           description: Webhook description, shown in the UI
 *           example: Forwards alert payloads to an external monitoring service
 *         body:
 *           type: string
 *           description: Optional request body template
 *           example: '{"alert": "{{title}}", "severity": "{{level}}"}'
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Last update timestamp
 *           example: "2025-06-15T10:30:00.000Z"
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Creation timestamp
 *           example: "2025-01-01T00:00:00.000Z"
 *     Webhook:
 *       oneOf:
 *         - $ref: '#/components/schemas/SlackWebhook'
 *         - $ref: '#/components/schemas/IncidentIOWebhook'
 *         - $ref: '#/components/schemas/GenericWebhook'
 *       discriminator:
 *         propertyName: service
 *         mapping:
 *           slack: '#/components/schemas/SlackWebhook'
 *           incidentio: '#/components/schemas/IncidentIOWebhook'
 *           generic: '#/components/schemas/GenericWebhook'
 *     WebhooksListResponse:
 *       type: object
 *       required:
 *         - data
 *       properties:
 *         data:
 *           type: array
 *           description: List of webhook objects.
 *           items:
 *             $ref: '#/components/schemas/Webhook'
 */

const router = express.Router();

/**
 * @openapi
 * /api/v2/webhooks:
 *   get:
 *     summary: List Webhooks
 *     description: Retrieves a list of all webhooks for the authenticated team
 *     operationId: listWebhooks
 *     tags: [Webhooks]
 *     responses:
 *       '200':
 *         description: Successfully retrieved webhooks
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhooksListResponse'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *             example:
 *               message: "Unauthorized access. API key is missing or invalid."
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }

    const webhooks: WebhookDocument[] = await Webhook.find({
      team: teamId.toString(),
    });

    return res.json({
      data: webhooks.map(formatExternalWebhook).filter(s => s !== undefined),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
