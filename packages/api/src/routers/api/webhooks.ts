import type {
  WebhookApiData,
  WebhookCreateApiResponse,
  WebhooksApiResponse,
  WebhookTestApiResponse,
  WebhookUpdateApiResponse,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import { AlertState } from '@/models/alert';
import Webhook, { WebhookService } from '@/models/webhook';
import {
  handleSendGenericWebhook,
  handleSendSlackWebhook,
} from '@/tasks/checkAlerts/template';

const router = express.Router();

// -- Redaction protocol --
// API responses replace sensitive values with a sentinel so clients can see
// which fields are configured without exposing the real secrets.
//   URL  →  <origin>/****          (hides path that may embed tokens)
//   header / queryParam values  →  ****   (keys are preserved)
// On PUT and POST /test the server recognises these sentinels and resolves
// them back to the stored values.  The assumption is that literal "****" is
// never a legitimate secret value.
const REDACTED_VALUE = '****';

const maskUrl = (url?: string): string | undefined => {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    return `${parsed.origin}/${REDACTED_VALUE}`;
  } catch {
    return REDACTED_VALUE;
  }
};

const redactMapValues = (
  map?: Record<string, string>,
): Record<string, string> | undefined => {
  if (!map || Object.keys(map).length === 0) return map;
  return Object.fromEntries(Object.keys(map).map(key => [key, REDACTED_VALUE]));
};

const sanitizeWebhook = (webhook: WebhookApiData): WebhookApiData => ({
  ...webhook,
  url: maskUrl(webhook.url),
  headers: redactMapValues(webhook.headers),
  queryParams: redactMapValues(webhook.queryParams),
});

const isMaskedUrl = (url: string, existingUrl?: string): boolean =>
  !!existingUrl && url === maskUrl(existingUrl);

type WebhookPlain = {
  url?: string;
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  service?: string;
};

const toWebhookPlain = (doc: mongoose.Document): WebhookPlain =>
  doc.toJSON({ flattenMaps: true }) as WebhookPlain;

const mergeRedactedMap = (
  existing: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (incoming === undefined || incoming === null) return existing;
  if (Object.keys(incoming).length === 0) return undefined;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === REDACTED_VALUE) {
      if (existing != null && key in existing) {
        result[key] = existing[key];
      }
    } else {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const mapHasRedactedValues = (map?: Record<string, string>): boolean =>
  map != null && Object.values(map).some(v => v === REDACTED_VALUE);

router.get(
  '/',
  validateRequest({
    query: z.object({
      service: z.union([
        z.nativeEnum(WebhookService),
        z.nativeEnum(WebhookService).array(),
      ]),
    }),
  }),
  async (req, res: express.Response<WebhooksApiResponse>, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      const { service } = req.query;
      const webhooks = await Webhook.find(
        { team: teamId, service },
        { __v: 0, team: 0 },
      );
      res.json({
        data: webhooks.map(w =>
          sanitizeWebhook(w.toJSON({ flattenMaps: true }) as WebhookApiData),
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

const httpHeaderNameValidator = z
  .string()
  .min(1, 'Header name cannot be empty')
  .regex(
    /^[!#$%&'*+\-.0-9A-Z^_`a-z|~]+$/,
    "Invalid header name. Only alphanumeric characters and !#$%&'*+-.^_`|~ are allowed",
  )
  .refine(name => !name.match(/^\d/), 'Header name cannot start with a number');

// Validation for header values: no control characters allowed
const httpHeaderValueValidator = z
  .string()
  // eslint-disable-next-line no-control-regex
  .refine(val => !/[\r\n\t\x00-\x1F\x7F]/.test(val), {
    message: 'Header values cannot contain control characters',
  });

router.post(
  '/',
  validateRequest({
    body: z.object({
      body: z.string().optional(),
      description: z.string().optional(),
      headers: z
        .record(httpHeaderNameValidator, httpHeaderValueValidator)
        .optional(),
      name: z.string(),
      queryParams: z.record(z.string()).optional(),
      service: z.nativeEnum(WebhookService),
      url: z.string().url(),
    }),
  }),
  async (
    req,
    res: express.Response<WebhookCreateApiResponse | { message: string }>,
    next,
  ) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      const { name, service, url, description, queryParams, headers, body } =
        req.body;
      if (await Webhook.findOne({ team: teamId, service, url })) {
        return res.status(400).json({
          message: 'Webhook already exists',
        });
      }
      const webhook = new Webhook({
        team: teamId,
        service,
        url,
        name,
        description,
        queryParams,
        headers,
        body,
      });
      await webhook.save();
      res.json({
        data: sanitizeWebhook(
          webhook.toJSON({ flattenMaps: true }) as WebhookApiData,
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.put(
  '/:id',
  validateRequest({
    params: z.object({
      id: z.string().refine(val => {
        return mongoose.Types.ObjectId.isValid(val);
      }),
    }),
    body: z.object({
      body: z.string().optional(),
      description: z.string().optional(),
      headers: z
        .record(httpHeaderNameValidator, httpHeaderValueValidator)
        .optional(),
      name: z.string(),
      queryParams: z.record(z.string()).optional(),
      service: z.nativeEnum(WebhookService),
      url: z.string().url(),
    }),
  }),
  async (
    req,
    res: express.Response<WebhookUpdateApiResponse | { message: string }>,
    next,
  ) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      const { name, service, url, description, queryParams, headers, body } =
        req.body;
      const { id } = req.params;

      // Check if webhook exists and belongs to team
      const existingWebhook = await Webhook.findOne({
        _id: id,
        team: teamId,
      });
      if (!existingWebhook) {
        return res.status(404).json({
          message: 'Webhook not found',
        });
      }

      const existingPlain = toWebhookPlain(existingWebhook);

      // Resolve masked/redacted fields against stored values
      const resolvedUrl = isMaskedUrl(url, existingPlain.url)
        ? existingPlain.url
        : url;
      const urlChanged = resolvedUrl !== existingPlain.url;

      // Prevent secret exfiltration: if the URL is changing, reject any
      // masked header/queryParam values — they would attach stored secrets
      // to the new (potentially attacker-controlled) destination.
      if (
        urlChanged &&
        (mapHasRedactedValues(headers) || mapHasRedactedValues(queryParams))
      ) {
        return res.status(400).json({
          message:
            'Cannot preserve masked secrets when changing the webhook URL. Re-enter all secret values.',
        });
      }

      const resolvedHeaders = mergeRedactedMap(existingPlain.headers, headers);
      const resolvedQueryParams = mergeRedactedMap(
        existingPlain.queryParams,
        queryParams,
      );

      // When URL is preserved via masked roundtrip, use the existing service
      // for the duplicate check to avoid an existence oracle across services.
      const duplicateCheckService = urlChanged
        ? service
        : existingPlain.service;
      const duplicateWebhook = await Webhook.findOne({
        team: teamId,
        service: duplicateCheckService,
        url: resolvedUrl,
        _id: { $ne: id },
      });
      if (duplicateWebhook) {
        return res.status(400).json({
          message: 'A webhook with this service and URL already exists',
        });
      }

      // Build update: use $unset for cleared map fields so Mongoose removes them
      const $set: Record<string, unknown> = {
        name,
        service,
        url: resolvedUrl,
        description,
        body,
      };
      const $unset: Record<string, 1> = {};

      if (resolvedHeaders !== undefined) {
        $set.headers = resolvedHeaders;
      } else {
        $unset.headers = 1;
      }
      if (resolvedQueryParams !== undefined) {
        $set.queryParams = resolvedQueryParams;
      } else {
        $unset.queryParams = 1;
      }

      const updateOp: Record<string, unknown> = { $set };
      if (Object.keys($unset).length > 0) {
        updateOp.$unset = $unset;
      }

      const updatedWebhook = await Webhook.findOneAndUpdate(
        { _id: id, team: teamId },
        updateOp,
        { new: true, select: { __v: 0, team: 0 } },
      );

      if (!updatedWebhook) {
        return res.status(404).json({
          message: 'Webhook not found after update',
        });
      }

      res.json({
        data: sanitizeWebhook(
          updatedWebhook.toJSON({ flattenMaps: true }) as WebhookApiData,
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({
    params: z.object({
      id: z.string().refine(val => {
        return mongoose.Types.ObjectId.isValid(val);
      }),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }
      await Webhook.findOneAndDelete({ _id: req.params.id, team: teamId });
      res.json({});
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/test',
  validateRequest({
    body: z.object({
      body: z.string().optional(),
      headers: z
        .record(httpHeaderNameValidator, httpHeaderValueValidator)
        .optional(),
      queryParams: z.record(z.string()).optional(),
      service: z.nativeEnum(WebhookService),
      url: z.string().url(),
      webhookId: z
        .string()
        .refine(val => mongoose.Types.ObjectId.isValid(val))
        .optional(),
    }),
  }),
  async (
    req,
    res: express.Response<WebhookTestApiResponse | { message: string }>,
    next,
  ) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { service, webhookId, body } = req.body;
      let { url, queryParams, headers } = req.body;

      // When testing an existing webhook, resolve masked/redacted values
      // only when the submitted URL still points at the stored destination.
      // This prevents exfiltrating stored secrets to an attacker-controlled URL.
      if (webhookId) {
        const existing = await Webhook.findOne({
          _id: webhookId,
          team: teamId,
        });
        if (!existing) {
          return res.status(404).json({ message: 'Webhook not found' });
        }
        const plain = toWebhookPlain(existing);
        const urlMatchesStored =
          url === plain.url || isMaskedUrl(url, plain.url);
        if (urlMatchesStored) {
          url = plain.url ?? url;
          headers = mergeRedactedMap(plain.headers, headers) ?? headers;
          queryParams =
            mergeRedactedMap(plain.queryParams, queryParams) ?? queryParams;
        }
      }

      // Create a temporary webhook object for testing
      const testWebhook = new Webhook({
        team: new ObjectId(teamId),
        service,
        url,
        queryParams,
        headers,
        body,
      });

      // Send test message
      const testMessage = {
        hdxLink: 'https://hyperdx.io',
        title: 'Test Webhook from HyperDX',
        body: 'This is a test message to verify your webhook configuration is working correctly.',
        startTime: Date.now(),
        endTime: Date.now(),
        state: AlertState.INSUFFICIENT_DATA,
        eventId: 'test-event-id',
      };

      if (service === WebhookService.Slack) {
        await handleSendSlackWebhook(testWebhook, testMessage);
      } else if (
        service === WebhookService.Generic ||
        service === WebhookService.IncidentIO
      ) {
        await handleSendGenericWebhook(testWebhook, testMessage);
      } else {
        return res.status(400).json({
          message: 'Unsupported webhook service type',
        });
      }

      res.json({
        message: 'Test webhook sent successfully',
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
