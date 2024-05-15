import express from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import Webhook, { WebhookService } from '@/models/webhook';

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

router.post(
  '/',
  validateRequest({
    body: z.object({
      body: z.string().optional(),
      description: z.string().optional(),
      headers: z.record(z.string()).optional(),
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
      const totalWebhooks = await Webhook.countDocuments({
        team: teamId,
        service,
      });
      if (totalWebhooks >= 5) {
        return res.status(400).json({
          message: 'You can only have 5 webhooks per team per service',
        });
      }
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

export default router;
