import express from 'express';

import { validateUserAccessKey } from '@/middleware/auth';
import { annotateSpanOnError, Api400Error, Api403Error } from '@/utils/errors';

import AlertChannel from '../../../models/alertChannel';

const router = express.Router();

router.get(
  '/',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const channels = await AlertChannel.find({ teamId: team?._id });
    res.json({
      version: 'v1',
      data: channels,
    });
  }),
);

router.get(
  '/:id',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const channel = await AlertChannel.findOne({
      _id: req.params.id,
      teamId: team?._id,
    });
    res.json({
      version: 'v1',
      data: channel,
    });
  }),
);

router.post(
  '/',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const channel = await AlertChannel.create({
      ...req.body,
      teamId: team?._id,
    });
    res.json({
      version: 'v1',
      data: channel,
    });
  }),
);

router.put(
  '/:id',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const { type, webhookId, priority } = req.body;
    const data = { type, webhookId, priority };

    await AlertChannel.findOneAndUpdate(
      { _id: req.params.id, teamId: team?._id },
      data,
    );
    const channel = await AlertChannel.findOne({
      _id: req.params.id,
      teamId: team?._id,
    });
    res.json({
      version: 'v1',
      data: channel,
    });
  }),
);

router.delete(
  '/:id',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const deleted = await AlertChannel.deleteOne({
      _id: req.params.id,
      teamId: team?._id,
    });
    res.json({
      version: 'v1',
      data: deleted,
    });
  }),
);

export { router as AlertChannelRouter };
