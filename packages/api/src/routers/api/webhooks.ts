import express from 'express';

import Webhook from '@/models/webhook';
import { isUserAuthenticated } from '@/middleware/auth';

const router = express.Router();

router.get('/', isUserAuthenticated, async (req, res, next) => {
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
});

router.post('/', isUserAuthenticated, async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    const { name, service, url } = req.body;
    if (!service || !url || !name) return res.sendStatus(400);
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
    const webhook = new Webhook({ team: teamId, service, url, name });
    await webhook.save();
    res.json({
      data: webhook,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', isUserAuthenticated, async (req, res, next) => {
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
});

export default router;
