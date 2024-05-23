import express from 'express';
import { uniq } from 'lodash';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import Alert from '@/models/alert';
import LogView from '@/models/logView';
import { objectIdSchema, tagsSchema } from '@/utils/zod';

const router = express.Router();

router.post(
  '/',
  validateRequest({
    body: z.object({
      name: z.string().max(1024).min(1),
      query: z.string().max(2048),
      tags: tagsSchema,
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const userId = req.user?._id;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { query, name, tags } = req.body;

      const logView = await new LogView({
        name,
        tags: tags && uniq(tags),
        query: `${query}`,
        team: teamId,
        creator: userId,
      }).save();

      res.json({
        data: logView,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    const logViews = await LogView.find(
      { team: teamId },
      {
        name: 1,
        query: 1,
        tags: 1,
        createdAt: 1,
        updatedAt: 1,
        columns: 1,
      },
    ).sort({ createdAt: -1 });
    const allAlerts = await Promise.all(
      logViews.map(lv => Alert.find({ logView: lv._id }, { __v: 0 })),
    );
    res.json({
      data: logViews.map((lv, idx) => ({
        ...lv.toJSON(),
        alerts: allAlerts[idx],
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.patch(
  '/:id',
  validateRequest({
    params: z.object({
      id: objectIdSchema,
    }),
    body: z.object({
      name: z.string().max(1024).min(1).optional(),
      query: z.string().max(2048).optional(),
      tags: tagsSchema,
      columns: z.array(z.string()),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const { id: logViewId } = req.params;
      if (teamId == null) {
        return res.sendStatus(403);
      }

      const { query, tags, name, columns } = req.body;
      const logView = await LogView.findOneAndUpdate(
        {
          _id: logViewId,
          team: teamId,
        },
        {
          ...(name && { name }),
          ...(query && { query }),
          tags: tags && uniq(tags),
          columns: columns,
        },
        { new: true },
      );
      res.json({
        data: logView,
      });
    } catch (e) {
      next(e);
    }
  },
);

router.delete('/:id', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const { id: logViewId } = req.params;
    if (teamId == null) {
      return res.sendStatus(403);
    }
    if (!logViewId) {
      return res.sendStatus(400);
    }
    // TODO: query teamId
    // delete all alerts
    await Alert.deleteMany({ logView: logViewId });
    await LogView.findByIdAndDelete(logViewId);
    res.sendStatus(200);
  } catch (e) {
    next(e);
  }
});

export default router;
