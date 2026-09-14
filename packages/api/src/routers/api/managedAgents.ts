import express from 'express';
import { pick } from 'lodash';
import mongoose from 'mongoose';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import Alert from '@/models/alert';
import ManagedAgent from '@/models/managedAgent';
import {
  AnthropicApiError,
  deleteAnthropicAgent,
  importAnthropicAgent,
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
// UI-managed key storage is a downstream-distribution concern registered via
// the `resolveAnthropicKey` extension seam — it is intentionally not part of
// the OSS surface.

// Only statuses HyperDX itself authored reach the browser. Forwarding
// Anthropic's 401 would log the user out of HyperDX entirely: the app's ky
// hook redirects to /login on any 401, so a bad server-side Anthropic key
// would read as an expired HyperDX session.
const HYPERDX_AUTHORED_STATUSES = new Set([400, 404, 409]);
const clientFacingStatus = (status: number) =>
  HYPERDX_AUTHORED_STATUSES.has(status) ? status : 502;

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) return res.sendStatus(403);
    // The agent's vault holds the creating user's ClickStack access key, so
    // who created it is part of what the agent *is*, not just trivia.
    const agents = await ManagedAgent.find({ team: teamId }, { __v: 0 })
      .populate<{
        createdBy?: { name?: string; email?: string };
      }>('createdBy', 'name email')
      .sort({ createdAt: -1 });
    res.json({
      data: agents.map(agent => ({
        ...agent.toJSON(),
        createdBy: agent.createdBy
          ? pick(agent.createdBy, ['name', 'email'])
          : undefined,
      })),
    });
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
      instructions: z.string().max(2000).optional(),
    }),
  }),
  async (req, res, next) => {
    try {
      if (!config.IS_MANAGED_AGENT_CREATE_ENABLED) {
        return res.status(403).json({
          message:
            'Provisioning new agents is disabled on this deployment. Import an existing Anthropic agent instead, or set HDX_MANAGED_AGENTS_ALLOW_CREATE=true.',
        });
      }
      const teamId = req.user?.team;
      const userId = req.user?._id;
      const userAccessKey = req.user?.accessKey;
      if (teamId == null || userId == null || !userAccessKey) {
        return res.sendStatus(403);
      }
      const { name, model, instructions } = req.body;
      const agent = await provisionClickStackAgent({
        teamId,
        userId,
        userAccessKey,
        name,
        model,
        instructions,
      });
      res.json({ data: agent });
    } catch (e) {
      if (e instanceof AnthropicApiError) {
        logger.error(
          { error: serializeError(e) },
          'Managed agent provisioning failed',
        );
        const status = clientFacingStatus(e.status);
        return res.status(status).json({ message: e.message });
      }
      next(e);
    }
  },
);

// Links an agent that already exists on Anthropic, so someone who provisioned
// one by hand can still use it as an alert target.
router.post(
  '/import',
  validateRequest({
    body: z.object({
      name: z.string().max(120).optional(),
      // Anthropic agent ids are opaque but flat. Constraining the shape here
      // keeps path separators out of the id before it ever reaches a URL.
      anthropicAgentId: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[A-Za-z0-9_-]+$/, 'Invalid agent ID'),
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
      // Named explicitly, never spread: validateRequest only validates, it
      // does not replace req.body with the stripped parse, so a spread would
      // let the caller's body override the authenticated team and key above.
      const { name, anthropicAgentId } = req.body;
      const { agent, verified } = await importAnthropicAgent({
        teamId,
        userId,
        userAccessKey,
        ...(name ? { name } : {}),
        anthropicAgentId,
      });
      res.json({ data: agent, verified });
    } catch (e) {
      if (e instanceof AnthropicApiError) {
        logger.error(
          { error: serializeError(e) },
          'Managed agent import failed',
        );
        const status = clientFacingStatus(e.status);
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

      // Mirrors the webhook route: deleting a referenced target would leave
      // those alerts erroring on every evaluation with no way to notice.
      // Both shapes are checked because pre-multi-channel alerts only have
      // the singular `channel`.
      const referencingAlerts = await Alert.countDocuments({
        team: teamId,
        $or: [
          { 'channel.agentId': req.params.id },
          { 'channels.agentId': req.params.id },
        ],
      });
      if (referencingAlerts > 0) {
        return res.status(409).json({
          message: `Cannot delete agent: ${referencingAlerts} alert(s) still reference it. Please update or remove those alerts first.`,
        });
      }

      // The local record is the only pointer to the Anthropic resources, so it
      // is dropped only once they are actually gone. Keeping it on failure
      // leaves the user something to retry instead of an invisible agent — and
      // a live vault holding their ClickStack access key. An imported agent
      // object belongs to the user, so only its vault and environment go.
      try {
        await deleteAnthropicAgent(
          teamId,
          agent.imported ? null : agent.anthropicAgentId,
          {
            vaultId: agent.vaultId,
            environmentId: agent.environmentId,
          },
        );
      } catch (e) {
        if (e instanceof AnthropicApiError) {
          logger.error(
            { error: serializeError(e), agentId: agent._id.toString() },
            'Managed agent deletion failed; keeping the local record',
          );
          const status = clientFacingStatus(e.status);
          return res.status(status).json({ message: e.message });
        }
        throw e;
      }
      await agent.deleteOne();
      res.json({});
    } catch (e) {
      next(e);
    }
  },
);

export default router;
