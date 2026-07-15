import express from 'express';
import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import ManagedAgent from '@/models/managedAgent';
import {
  AnthropicApiError,
  deleteAnthropicAgent,
  provisionClickStackAgent,
} from '@/services/anthropicAgents';
import logger from '@/utils/logger';

const router = express.Router();

// Feature-flagged: the whole surface 404s unless explicitly enabled.
router.use((req, res, next) => {
  if (!config.IS_MANAGED_AGENTS_ENABLED) {
    return res.sendStatus(404);
  }
  next();
});

// The Anthropic API key is resolved from the environment in the open-source
// distribution (see getTeamAnthropicKey / resolveEnvAnthropicKey). Per-team,
// UI-managed key storage is a downstream (hyperdx-ee) concern registered via
// the `resolveAnthropicKey` extension seam — it is intentionally not part of
// the OSS surface.

// ----------------------- Managed agents ------------------------------

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) return res.sendStatus(403);
    const agents = await ManagedAgent.find({ team: teamId }, { __v: 0 }).sort({
      createdAt: -1,
    });
    res.json({ data: agents });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/',
  validateRequest({
    body: z.object({
      name: z.string().min(1).max(120),
      model: z.string().min(1),
    }),
  }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      const userId = req.user?._id;
      const userAccessKey = req.user?.accessKey;
      if (teamId == null || userId == null || !userAccessKey) {
        return res.sendStatus(403);
      }
      const { name, model } = req.body;
      const agent = await provisionClickStackAgent({
        teamId,
        userId,
        userAccessKey,
        name,
        model,
      });
      res.json({ data: agent });
    } catch (e) {
      if (e instanceof AnthropicApiError) {
        logger.error(
          { error: serializeError(e) },
          'Managed agent provisioning failed',
        );
        // Forward 4xx (e.g. missing key, bad Anthropic key) as-is; treat
        // upstream 5xx as a bad-gateway.
        const status = e.status >= 400 && e.status < 500 ? e.status : 502;
        return res.status(status).json({ message: e.message });
      }
      next(e);
    }
  },
);

router.delete(
  '/:id',
  validateRequest({ params: z.object({ id: z.string() }) }),
  async (req, res, next) => {
    try {
      const teamId = req.user?.team;
      if (teamId == null) return res.sendStatus(403);
      if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
        return res.status(400).json({ message: 'Invalid id' });
      }
      const agent = await ManagedAgent.findOne({
        _id: req.params.id,
        team: teamId,
      });
      if (!agent) return res.status(404).json({ message: 'Agent not found' });
      await deleteAnthropicAgent(teamId, agent.anthropicAgentId);
      await agent.deleteOne();
      res.json({ message: 'Deleted' });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
