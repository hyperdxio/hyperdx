import type {
  MeApiResponse,
  OnboardingDataApiResponse,
  RotateAccessKeyApiResponse,
} from '@hyperdx/common-utils/dist/types';
import {
  CompleteOnboardingTaskApiBodySchema,
  DismissOnboardingApiBodySchema,
  OnboardingDataSchema,
} from '@hyperdx/common-utils/dist/types';
import express from 'express';
import { validateRequest } from 'zod-express-middleware';

import { AI_API_KEY, ANTHROPIC_API_KEY, USAGE_STATS_ENABLED } from '@/config';
import { getTeam } from '@/controllers/team';
import {
  completeOnboardingTask,
  rotateUserAccessKey,
  setOnboardingDismissed,
} from '@/controllers/user';
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
      onboardingData,
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
      // Parse through the schema so users created before onboardingData existed
      // (and any partially-written subdocument) read back with defaults.
      onboardingData: OnboardingDataSchema.parse(onboardingData ?? {}),
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

type OnboardingExpRes = express.Response<OnboardingDataApiResponse>;

// Mark a product-usage onboarding task complete for the caller. The user id
// comes from the session, never the request, so a caller can only ever mutate
// their own onboarding state. Idempotent (see completeOnboardingTask).
router.post(
  '/onboarding/task',
  validateRequest({ body: CompleteOnboardingTaskApiBodySchema }),
  async (req, res: OnboardingExpRes, next) => {
    try {
      const userId = req.user?._id;
      if (userId == null) {
        throw new Api404Error('Request without user found');
      }

      const user = await completeOnboardingTask(userId, req.body.taskId);
      return sendJson(res, {
        onboardingData: OnboardingDataSchema.parse(user?.onboardingData ?? {}),
      });
    } catch (e) {
      next(e);
    }
  },
);

router.patch(
  '/onboarding/dismiss',
  validateRequest({ body: DismissOnboardingApiBodySchema }),
  async (req, res: OnboardingExpRes, next) => {
    try {
      const userId = req.user?._id;
      if (userId == null) {
        throw new Api404Error('Request without user found');
      }

      const user = await setOnboardingDismissed(userId, req.body.isDismissed);
      return sendJson(res, {
        onboardingData: OnboardingDataSchema.parse(user?.onboardingData ?? {}),
      });
    } catch (e) {
      next(e);
    }
  },
);

export default router;
