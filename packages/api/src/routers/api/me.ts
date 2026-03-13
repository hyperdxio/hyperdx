import {
  type MeApiResponse,
  MeApiResponseSchema,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';

import { AI_API_KEY, ANTHROPIC_API_KEY, USAGE_STATS_ENABLED } from '@/config';
import { getTeam } from '@/controllers/team';
import { Api404Error } from '@/utils/errors';

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

    return res.json({
      accessKey,
      createdAt: createdAt.toISOString(),
      email,
      id: id.toString(),
      name,
      team: MeApiResponseSchema.shape.team.parse(team.toJSON()),
      usageStatsEnabled: USAGE_STATS_ENABLED,
      aiAssistantEnabled: !!(AI_API_KEY || ANTHROPIC_API_KEY),
    });
  } catch (e) {
    next(e);
  }
});

export default router;
