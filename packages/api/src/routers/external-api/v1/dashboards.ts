import express from 'express';

import { validateUserAccessKey } from '@/middleware/auth';
import { annotateSpanOnError, Api400Error, Api403Error } from '@/utils/errors';

import Dashboard from '../../../models/dashboard';

const router = express.Router();

router.get(
  '/',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const dashboards = await Dashboard.find({ team: team?._id });
    res.json({
      version: 'v1',
      data: dashboards,
    });
  }),
);

router.get(
  '/:id',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const dashboard = await Dashboard.findOne({
      _id: req.params.id,
      team: team?._id,
    });
    res.json({
      version: 'v1',
      data: dashboard,
    });
  }),
);

router.post(
  '/',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const dashboard = await Dashboard.create({
      ...req.body,
      team: team?._id,
    });
    res.json({
      version: 'v1',
      data: dashboard,
    });
  }),
);

router.put(
  '/:id',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const { name, query, charts } = req.body;
    const data = { name, query, charts };

    await Dashboard.findOneAndUpdate(
      { _id: req.params.id, team: team?._id },
      data,
    );
    const dashboard = await Dashboard.findOne({
      _id: req.params.id,
      team: team?._id,
    });
    res.json({
      version: 'v1',
      data: dashboard,
    });
  }),
);

router.delete(
  '/:id',
  validateUserAccessKey,
  annotateSpanOnError(async (req, res, next) => {
    const team = req.user?.team;
    const deleted = await Dashboard.deleteOne({
      _id: req.params.id,
      team: team?._id,
    });
    res.json({
      version: 'v1',
      data: deleted,
    });
  }),
);

export { router as DashboardsRouter };
