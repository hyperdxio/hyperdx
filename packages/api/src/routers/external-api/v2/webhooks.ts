import express from 'express';
import { z } from 'zod';

import { WebhookDocument } from '@/models/webhook';
import Webhook from '@/models/webhook';
import { processRequestWithEnhancedErrors as validateRequest } from '@/utils/enhancedErrors';
import logger from '@/utils/logger';
import {
  getPagination,
  paginationMeta,
  paginationQuerySchema,
} from '@/utils/pagination';
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

  // If parsing fails, log only non-sensitive identifiers and the error. The
  // raw webhook document carries write-only headers/queryParams (auth tokens),
  // so it must never be written to logs.
  logger.error(
    {
      webhookId: String(webhook._id),
      service: webhook.service,
      error: parseResult.error,
    },
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
 *     PaginationMeta:
 *       type: object
 *       required:
 *         - total
 *         - limit
 *         - offset
 *       properties:
 *         total:
 *           type: integer
 *           description: Total number of items matching the query, ignoring pagination.
 *           example: 142
 *         limit:
 *           type: integer
 *           description: Maximum number of items returned in this page.
 *           example: 50
 *         offset:
 *           type: integer
 *           description: Number of items skipped before this page.
 *           example: 100
 *     WebhooksListResponse:
 *       type: object
 *       required:
 *         - data
 *         - meta
 *       properties:
 *         data:
 *           type: array
 *           description: List of webhook objects.
 *           items:
 *             $ref: '#/components/schemas/Webhook'
 *         meta:
 *           $ref: '#/components/schemas/PaginationMeta'
 *           description: Pagination metadata for this result page.
 */

const router = express.Router();

/**
 * @openapi
 * /api/v2/webhooks:
 *   get:
 *     summary: List Webhooks
 *     description: >-
 *       Retrieves webhooks for the authenticated team (paginated). Results are
 *       capped at `limit` (default and maximum 1000). When more records exist
 *       than are returned, `meta.total` exceeds `data.length`; clients with
 *       large collections must page with `limit`/`offset` to retrieve them all.
 *     operationId: listWebhooks
 *     tags: [Webhooks]
 *     parameters:
 *       - name: limit
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 1000
 *           default: 1000
 *         description: Maximum number of webhooks to return.
 *       - name: offset
 *         in: query
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 0
 *           default: 0
 *         description: Number of webhooks to skip before returning results.
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
router.get(
  '/',
  validateRequest({ query: paginationQuerySchema }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.status(403).json({ message: 'Forbidden' });
      }

      const { limit, offset } = getPagination(req.query);
      const filter = { team: teamId.toString() };
      // Sort by _id so skip/offset paging is stable across requests.
      const [webhooks, total] = await Promise.all([
        Webhook.find(filter).sort({ _id: 1 }).skip(offset).limit(limit),
        Webhook.countDocuments(filter),
      ]);

      // Surface the full count at the HTTP layer too, so a client that reads
      // headers but not the `meta` body can still detect truncation.
      res.set('X-Total-Count', String(total));
      return res.json({
        data: webhooks.map(formatExternalWebhook).filter(s => s !== undefined),
        meta: paginationMeta({ limit, offset }, total, 'webhooks'),
      });
    } catch (e) {
      next(e);
    }
  },
);

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
 *         Webhook create/update body. `body`, `headers`, and `queryParams`
 *         only take effect for services that issue a templated HTTP request
 *         (`generic`, `incidentio`). The `slack` service posts a fixed payload
 *         to its incoming-webhook URL and ignores them, so supplying any of
 *         these fields on a `slack` webhook is rejected. `headers` and
 *         `queryParams` are write-only — they are accepted here but never
 *         returned by any read endpoint, so secrets such as auth tokens do
 *         not leak. On
 *         update (PUT), omitted readable fields (`description`, `body`) are
 *         cleared, while omitted `headers`/`queryParams` are preserved —
 *         send an explicit `{}` to clear them. Exception: if the destination
 *         (`url` or `service`) changes, omitted `headers`/`queryParams` are
 *         cleared rather than preserved, so stored secrets are never forwarded
 *         to a new destination; re-supply them for the new destination.
 *       properties:
 *         name:
 *           type: string
 *           maxLength: 1024
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
 *           maxLength: 2048
 *           description: Webhook destination URL.
 *           example: https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX
 *         description:
 *           type: string
 *           maxLength: 2048
 *           description: Webhook description, shown in the UI.
 *           example: "Sends critical alerts to the #incidents channel"
 *         body:
 *           type: string
 *           maxLength: 16384
 *           description: Optional request body template. Only for generic/incidentio; rejected for slack.
 *           example: '{"alert": "{{title}}", "severity": "{{level}}"}'
 *         headers:
 *           type: object
 *           maxProperties: 100
 *           description: Write-only. Custom HTTP headers sent with the webhook request. Never returned on read. Only for generic/incidentio; rejected for slack. Each value is capped at 4096 characters.
 *           additionalProperties:
 *             type: string
 *             maxLength: 4096
 *           example:
 *             Authorization: Bearer secret-token
 *         queryParams:
 *           type: object
 *           maxProperties: 100
 *           description: Write-only. Query parameters appended to the webhook URL. Never returned on read. Only for generic/incidentio; rejected for slack. Each value is capped at 4096 characters.
 *           additionalProperties:
 *             type: string
 *             maxLength: 4096
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
 *       send an explicit empty object (`{}`) to clear them. Exception: if the
 *       destination (`url` or `service`) changes, omitted `headers`/
 *       `queryParams` are cleared rather than preserved so stored secrets are
 *       never forwarded to a new destination.
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
 *       '409':
 *         description: Webhook was modified concurrently; retry with current state
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

      const existing = await Webhook.findOne({
        _id: req.params.id,
        team: teamId,
      });
      if (existing == null) {
        return res.status(404).json({ message: 'Webhook not found' });
      }

      // Readable fields are a full replace: present => $set, omitted =>
      // $unset. Write-only fields (headers/queryParams) are never returned
      // on read, so a read-modify-write client cannot re-send them — omitting
      // them normally preserves the stored values; send an explicit {} to
      // clear.
      const $set: Record<string, unknown> = { name, service, url };
      const $unset: Record<string, 1> = {};
      for (const [key, value] of Object.entries({ description, body })) {
        if (value === undefined) {
          $unset[key] = 1;
        } else {
          $set[key] = value;
        }
      }

      // Security: if the destination changes (url or service), do NOT preserve
      // omitted write-only secrets. A caller who cannot read headers/queryParams
      // back could otherwise repoint url at an endpoint they control and have
      // the stored secret headers forwarded there when the alert fires
      // (template.ts spreads webhook.headers into the outbound request). When
      // the destination changes, omitted write-only fields are cleared and the
      // caller must re-supply them for the new destination.
      const destinationChanged =
        url !== existing.url || service !== existing.service;
      for (const [key, value] of Object.entries({ headers, queryParams })) {
        if (value === undefined) {
          if (destinationChanged) {
            $unset[key] = 1;
          }
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

      // The destinationChanged decision above (whether to preserve or clear
      // omitted write-only secrets) was computed from the `existing` snapshot,
      // which is not atomic with the write below. Pin the update to the
      // snapshotted url/service so a concurrent PUT that changes the
      // destination in between cannot leave a secret configured for one
      // destination attached to a different url. If they changed, reject with
      // 409 and let the caller retry against the current state.
      const webhook = await Webhook.findOneAndUpdate(
        {
          _id: req.params.id,
          team: teamId,
          url: existing.url,
          service: existing.service,
        },
        updateOp,
        { new: true },
      );

      if (webhook == null) {
        // Distinguish a concurrent-modification conflict from a real 404.
        const stillExists = await Webhook.exists({
          _id: req.params.id,
          team: teamId,
        });
        if (stillExists != null) {
          return res.status(409).json({
            message:
              'Webhook was modified concurrently; please retry with the current state',
          });
        }
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
