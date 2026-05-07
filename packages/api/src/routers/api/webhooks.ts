import type {
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

const sanitizeWebhook = <T extends Record<string, unknown>>(webhook: T): T =>
  ({
    ...webhook,
    url: maskUrl(webhook.url as string | undefined),
    headers: redactMapValues(
      webhook.headers as Record<string, string> | undefined,
    ),
    queryParams: redactMapValues(
      webhook.queryParams as Record<string, string> | undefined,
    ),
  }) as T;

const isMaskedUrl = (url: string): boolean => {
  try {
    return new URL(url).pathname === `/${REDACTED_VALUE}`;
  } catch {
    return false;
  }
};

const mergeRedactedMap = (
  existing: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
): Record<string, string> | undefined => {
  if (incoming === undefined || incoming === null) return existing;
  if (Object.keys(incoming).length === 0) return undefined;

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === REDACTED_VALUE) {
      if (existing?.[key]) {
        result[key] = existing[key];
      }
    } else {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

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
          sanitizeWebhook(w.toJSON({ flattenMaps: true })),
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
        data: sanitizeWebhook(webhook.toJSON({ flattenMaps: true })),
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

      const existingPlain = existingWebhook.toJSON({
        flattenMaps: true,
      }) as {
        url?: string;
        headers?: Record<string, string>;
        queryParams?: Record<string, string>;
      };

      // Resolve masked/redacted fields against stored values
      const resolvedUrl = isMaskedUrl(url) ? existingPlain.url : url;
      const resolvedHeaders = mergeRedactedMap(existingPlain.headers, headers);
      const resolvedQueryParams = mergeRedactedMap(
        existingPlain.queryParams,
        queryParams,
      );

      // Check if another webhook with same service and url already exists (excluding current webhook)
      const duplicateWebhook = await Webhook.findOne({
        team: teamId,
        service,
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
        data: sanitizeWebhook(updatedWebhook.toJSON({ flattenMaps: true })),
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
    }),
  }),
  async (req, res: express.Response<WebhookTestApiResponse>, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { service, url, queryParams, headers, body } = req.body;

      // Create a temporary webhook object for testing
      const testWebhook = new Webhook({
        team: new ObjectId(teamId),
        service,
        url,
        queryParams: queryParams,
        headers: headers,
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
