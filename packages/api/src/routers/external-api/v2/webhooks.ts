import express from 'express';
import { z } from 'zod';

import { WebhookDocument } from '@/models/webhook';
import Webhook from '@/models/webhook';
import { processRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import logger from '@/utils/logger';
import {
  ExternalWebhook,
  externalWebhookCreateSchema,
  externalWebhookSchema,
  objectIdSchema,
} from '@/utils/zod';

// A duplicate (team, service, name) violates the unique index on the Webhook
// model. Surface it as a 400 instead of a 500.
function isDuplicateKeyError(e: unknown): boolean {
  return (
    e != null &&
    typeof e === 'object' &&
    (e as { code?: unknown }).code === 11000
  );
}

const DUPLICATE_WEBHOOK_MESSAGE =
  'A webhook with this service and name already exists';

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
 *           example: "Sends critical alerts to the #incidents channel"
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

/**
 * @openapi
 * components:
 *   schemas:
 *     WebhookInput:
 *       type: object
 *       required:
 *         - name
 *         - service
 *         - url
 *       description: |
 *         Webhook create/update body. `headers` and `queryParams` are
 *         write-only — they are accepted here but never returned by any
 *         read endpoint, so secrets such as auth tokens do not leak. On
 *         update (PUT), omitted readable fields (`description`, `body`) are
 *         cleared, while omitted `headers`/`queryParams` are preserved —
 *         send an explicit `{}` to clear them.
 *       properties:
 *         name:
 *           type: string
 *           description: Webhook name. Must be unique per service within the team.
 *           example: Production Alerts
 *         service:
 *           type: string
 *           enum: [slack, incidentio, generic]
 *           description: Webhook service type.
 *           example: slack
 *         url:
 *           type: string
 *           format: uri
 *           description: Webhook destination URL.
 *           example: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
 *         description:
 *           type: string
 *           description: Webhook description, shown in the UI.
 *           example: "Sends critical alerts to the #incidents channel"
 *         body:
 *           type: string
 *           description: Optional request body template (generic webhooks).
 *           example: '{"alert": "{{title}}", "severity": "{{level}}"}'
 *         headers:
 *           type: object
 *           description: Write-only. Custom HTTP headers sent with the webhook request. Never returned on read.
 *           additionalProperties:
 *             type: string
 *           example:
 *             Authorization: Bearer secret-token
 *         queryParams:
 *           type: object
 *           description: Write-only. Query parameters appended to the webhook URL. Never returned on read.
 *           additionalProperties:
 *             type: string
 *     WebhookResponseEnvelope:
 *       type: object
 *       properties:
 *         data:
 *           $ref: '#/components/schemas/Webhook'
 *           description: The webhook object.
 */

/**
 * @openapi
 * /api/v2/webhooks:
 *   post:
 *     summary: Create Webhook
 *     description: Creates a new webhook for the authenticated team.
 *     operationId: createWebhook
 *     tags: [Webhooks]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WebhookInput'
 *     responses:
 *       '200':
 *         description: Successfully created webhook
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookResponseEnvelope'
 *       '400':
 *         description: Bad request or duplicate webhook
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.post(
  '/',
  validateRequest({ body: externalWebhookCreateSchema }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const { name, service, url, description, queryParams, headers, body } =
        req.body;

      const webhook = await Webhook.create({
        team: teamId,
        name,
        service,
        url,
        description,
        queryParams,
        headers,
        body,
      });

      const data = formatExternalWebhook(webhook);
      if (data === undefined) {
        throw new Error(
          `Failed to serialize webhook ${webhook._id} for external API`,
        );
      }

      res.json({ data });
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        return res.status(400).json({ message: DUPLICATE_WEBHOOK_MESSAGE });
      }
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/webhooks/{id}:
 *   put:
 *     summary: Update Webhook
 *     description: |
 *       Replaces an existing webhook. Readable optional fields
 *       (`description`, `body`) are a full replace: omitting them clears
 *       them. The write-only fields `headers` and `queryParams` are never
 *       returned on read, so omitting them preserves the stored values;
 *       send an explicit empty object (`{}`) to clear them.
 *     operationId: updateWebhook
 *     tags: [Webhooks]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Webhook ID
 *         example: "507f1f77bcf86cd799439011"
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/WebhookInput'
 *     responses:
 *       '200':
 *         description: Successfully updated webhook
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/WebhookResponseEnvelope'
 *       '400':
 *         description: Bad request or duplicate webhook
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '401':
 *         description: Unauthorized
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Webhook not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.put(
  '/:id',
  validateRequest({
    params: z.object({ id: objectIdSchema }),
    body: externalWebhookCreateSchema,
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const { name, service, url, description, queryParams, headers, body } =
        req.body;

      // Readable fields are a full replace: present => $set, omitted =>
      // $unset. Write-only fields (headers/queryParams) are never returned
      // on read, so a read-modify-write client cannot re-send them — omitting
      // them preserves the stored values; send an explicit {} to clear.
      const $set: Record<string, unknown> = { name, service, url };
      const $unset: Record<string, 1> = {};
      for (const [key, value] of Object.entries({ description, body })) {
        if (value === undefined) {
          $unset[key] = 1;
        } else {
          $set[key] = value;
        }
      }
      for (const [key, value] of Object.entries({ headers, queryParams })) {
        if (value === undefined) {
          continue;
        }
        if (Object.keys(value).length === 0) {
          $unset[key] = 1;
        } else {
          $set[key] = value;
        }
      }

      const updateOp: Record<string, unknown> =
        Object.keys($unset).length > 0 ? { $set, $unset } : { $set };

      const webhook = await Webhook.findOneAndUpdate(
        { _id: req.params.id, team: teamId },
        updateOp,
        { new: true },
      );

      if (webhook == null) {
        return res.status(404).json({ message: 'Webhook not found' });
      }

      const data = formatExternalWebhook(webhook);
      if (data === undefined) {
        throw new Error(
          `Failed to serialize webhook ${webhook._id} for external API`,
        );
      }

      res.json({ data });
    } catch (e) {
      if (isDuplicateKeyError(e)) {
        return res.status(400).json({ message: DUPLICATE_WEBHOOK_MESSAGE });
      }
      next(e);
    }
  },
);

/**
 * @openapi
 * /api/v2/webhooks/{id}:
 *   delete:
 *     summary: Delete Webhook
 *     description: Deletes a webhook.
 *     operationId: deleteWebhook
 *     tags: [Webhooks]
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Webhook ID
 *         example: "507f1f77bcf86cd799439011"
 *     responses:
 *       '200':
 *         description: Successfully deleted webhook
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
 *       '403':
 *         description: Forbidden
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       '404':
 *         description: Webhook not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 */
router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: objectIdSchema }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const deleted = await Webhook.findOneAndDelete({
        _id: req.params.id,
        team: teamId,
      });

      if (deleted == null) {
        return res.status(404).json({ message: 'Webhook not found' });
      }

      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
