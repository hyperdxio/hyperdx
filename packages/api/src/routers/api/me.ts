import type {
  MeApiResponse,
  UpdateUserLabsApiResponse,
} from '@hyperdx/common-utils/dist/types';
import { UpdateUserLabsRequestSchema } from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { processRequest } from 'zod-express-middleware';

import { AI_API_KEY, ANTHROPIC_API_KEY, USAGE_STATS_ENABLED } from '@/config';
import { getTeam } from '@/controllers/team';
import { setUserLabs } from '@/controllers/user';
import { getNonNullUserWithTeam } from '@/middleware/auth';
import { Api404Error } from '@/utils/errors';
import { setBusinessContext } from '@/utils/instrumentation';
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
      labs,
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
      // Absent on every user created before labs existed; `{}` reads as
      // "nothing enabled", which is what the client expects.
      labs: labs ?? {},
    });
  } catch (e) {
    next(e);
  }
});

/**
 * Replaces the caller's lab opt-ins. A sub-path rather than `PATCH /me` because
 * `GET /me` also returns email, name, accessKey and team — an endpoint that
 * merely *looks* like it accepts edits to those is a hazard worth avoiding.
 */
router.patch(
  '/labs',
  processRequest({ body: UpdateUserLabsRequestSchema }),
  async (req, res: express.Response<UpdateUserLabsApiResponse>, next) => {
    try {
      const { userId } = getNonNullUserWithTeam(req);
      const { labs } = req.body;

      const user = await setUserLabs(userId, labs);
      if (user == null) {
        throw new Api404Error(`User not found for id ${userId}`);
      }

      // A wide-event span attribute, deliberately not a metric: lab ids are
      // client-supplied, so using them as metric attribute values would be
      // unbounded cardinality. Team/user context is already on the span from
      // isUserAuthenticated. See agent_docs/observability.md.
      setBusinessContext({
        'hyperdx.user.labs.enabled': Object.keys(labs).filter(id => labs[id]),
      });

      return sendJson(res, { labs: user.labs ?? {} });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
