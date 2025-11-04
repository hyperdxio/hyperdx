import express from 'express';
import { ObjectId } from 'mongodb';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import Webhook, { WebhookService } from '@/models/webhook';
import {
  handleSendGenericWebhook,
  handleSendSlackWebhook,
} from '@/tasks/checkAlerts/template';

const router = express.Router();

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
  async (req, res, next) => {
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
        data: webhooks,
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
  async (req, res, next) => {
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
        data: webhook,
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
  async (req, res, next) => {
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

      // Check if another webhook with same service and url already exists (excluding current webhook)
      const duplicateWebhook = await Webhook.findOne({
        team: teamId,
        service,
        url,
        _id: { $ne: id },
      });
      if (duplicateWebhook) {
        return res.status(400).json({
          message: 'A webhook with this service and URL already exists',
        });
      }

      // Update webhook
      const updatedWebhook = await Webhook.findOneAndUpdate(
        { _id: id, team: teamId },
        {
          name,
          service,
          url,
          description,
          queryParams,
          headers,
          body,
        },
        { new: true, select: { __v: 0, team: 0 } },
      );

      res.json({
        data: updatedWebhook,
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
  async (req, res, next) => {
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
      };

      if (service === WebhookService.Slack) {
        await handleSendSlackWebhook(testWebhook, testMessage);
      } else if (service === WebhookService.Generic) {
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
