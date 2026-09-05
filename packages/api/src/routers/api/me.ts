import type {
  MeApiResponse,
  RotateAccessKeyApiResponse,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';

import { AI_API_KEY, ANTHROPIC_API_KEY, USAGE_STATS_ENABLED } from '@/config';
import { getTeam } from '@/controllers/team';
import { rotateUserAccessKey } from '@/controllers/user';
import { Api404Error } from '@/utils/errors';
import { sendJson } from '@/utils/serialization';

const router = express.Router();

router.get('/', async (req, res: express.Response<MeApiResponse>, next) => {
  try {
    if (req.user == null) {
      throw new Api404Error('Request without user found');
    }

    const {
      _id: id,
      accessKey,
      createdAt,
      email,
      name,
      team: teamId,
    } = req.user;

    const team = await getTeam(teamId);
    if (team == null) {
      throw new Api404Error(`Team not found for user ${id}`);
    }

    return sendJson(res, {
      accessKey,
      createdAt,
      email,
      id,
      name,
      team,
      usageStatsEnabled: USAGE_STATS_ENABLED,
      aiAssistantEnabled: !!(AI_API_KEY || ANTHROPIC_API_KEY),
    });
  } catch (e) {
    next(e);
  }
});

type RotateAccessKeyExpRes = express.Response<RotateAccessKeyApiResponse>;

// Rotating your own personal access key. The user id comes from the session
// (isUserAuthenticated, applied at mount time in api-app.ts) and never from the
// request, so this route can only ever rotate the caller's own key.
//
// Deliberately NOT mirrored onto the bearer-authed external API v2: `GET /api/v2`
// echoes the caller's accessKey back, so a leaked key that could also rotate
// would let an attacker lock the legitimate owner out of their own tooling.
router.patch('/accessKey', async (req, res: RotateAccessKeyExpRes, next) => {
  try {
    const userId = req.user?._id;
    if (userId == null) {
      throw new Api404Error('Request without user found');
    }

    const user = await rotateUserAccessKey(userId);
    if (user?.accessKey == null) {
      throw new Error(`Failed to rotate access key for user ${userId}`);
    }

    return sendJson(res, { newAccessKey: user.accessKey });
  } catch (e) {
    next(e);
  }
});

export default router;
