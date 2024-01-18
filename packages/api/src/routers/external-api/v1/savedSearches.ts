import express from 'express';

import { validateUserAccessKey } from '@/middleware/auth';
import { annotateSpanOnError, Api400Error, Api403Error } from '@/utils/errors';

import LogView from '../../../models/logView';

const router = express.Router();

router.get(
  '/',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const searches = await LogView.find({ team: team?._id });
    res.json({
      version: 'v1',
      data: searches,
    });
  }),
);

router.get(
  '/:id',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const search = await LogView.findOne({
      _id: req.params.id,
      team: team?._id,
    });
    res.json({
      version: 'v1',
      data: search,
    });
  }),
);

router.post(
  '/',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const search = await LogView.create({
      ...req.body,
      creator: req.user?._id,
      team: team?._id,
    });
    res.json({
      version: 'v1',
      data: search,
    });
  }),
);

router.put(
  '/:id',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const { name, query } = req.body;
    const data = { name, query };

    await LogView.findOneAndUpdate(
      { _id: req.params.id, team: team?._id },
      data,
    );
    const search = await LogView.findOne({
      _id: req.params.id,
      team: team?._id,
    });
    res.json({
      version: 'v1',
      data: search,
    });
  }),
);

router.delete(
  '/:id',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const deleted = await LogView.deleteOne({
      _id: req.params.id,
      team: team?._id,
    });
    res.json({
      version: 'v1',
      data: deleted,
    });
  }),
);

export { router as SavedSearchesRouter };
