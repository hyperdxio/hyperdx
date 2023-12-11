import crypto from 'crypto';

import express from 'express';
import isemail from 'isemail';
import pick from 'lodash/pick';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user';
import logger from '@/utils/logger';
import { findUserByEmail, findUsersByTeam } from '@/controllers/user';
import { getTeam, rotateTeamApiKey } from '@/controllers/team';
import { redirectToDashboard } from '@/middleware/auth';
import { validatePassword } from '@/utils/validators';

const router = express.Router();

router.post('/', async (req, res, next) => {
  try {
    const { email: toEmail, name } = req.body;

    if (!toEmail || !isemail.validate(toEmail)) {
      return res.status(400).json({
        message: 'Invalid email',
      });
    }

    const teamId = req.user?.team;
    const fromEmail = req.user?.email;

    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    if (fromEmail == null) {
      throw new Error(`User ${req.user?._id} doesnt have email`);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      throw new Error(`Team ${teamId} not found`);
    }

    const toUser = await findUserByEmail(toEmail);
    if (toUser) {
      return res.status(400).json({
        message: 'User already exists. Please contact HyperDX team for support',
      });
    }

    let teamInvite = await TeamInvite.findOne({
      teamId: team._id,
      email: toEmail, // TODO: case insensitive ?
    });

    if (!teamInvite) {
      teamInvite = await new TeamInvite({
        teamId: team._id,
        name,
        email: toEmail, // TODO: case insensitive ?
        token: crypto.randomBytes(32).toString('hex'),
      }).save();
    }

    res.json({
      url: `${config.FRONTEND_URL}/join-team?token=${teamInvite.token}`,
    });
  } catch (e) {
    next(e);
  }
});

const getSentryDSN = (apiKey: string, ingestorApiUrl: string) => {
  try {
    const url = new URL(ingestorApiUrl);
    url.username = apiKey.replaceAll('-', '');
    url.pathname = '0';
    // TODO: Set up hostname from env variable
    url.hostname = 'localhost';
    return url.toString();
  } catch (e) {
    logger.error(serializeError(e));
    return '';
  }
};

router.get('/', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    const userId = req.user?._id;

    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    if (userId == null) {
      throw new Error(`User has no id`);
    }

    const team = await getTeam(teamId);
    if (team == null) {
      throw new Error(`Team ${teamId} not found for user ${userId}`);
    }

    const teamUsers = await findUsersByTeam(teamId);
    const teamInvites = await TeamInvite.find({});

    res.json({
      ...pick(team.toJSON(), [
        '_id',
        'allowedAuthMethods',
        'apiKey',
        'archive',
        'name',
        'slackAlert',
      ]),
      users: teamUsers.map(user => ({
        ...pick(user.toJSON({ virtuals: true }), [
          'email',
          'name',
          'hasPasswordAuth',
        ]),
        isCurrentUser: user._id.equals(userId),
      })),
      teamInvites: teamInvites.map(ti => ({
        createdAt: ti.createdAt,
        email: ti.email,
        name: ti.name,
        url: `${config.FRONTEND_URL}/join-team?token=${ti.token}`,
      })),
      sentryDSN: getSentryDSN(team.apiKey, config.INGESTOR_API_URL),
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/apiKey', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }
    const team = await rotateTeamApiKey(teamId);
    res.json({ newApiKey: team?.apiKey });
  } catch (e) {
    next(e);
  }
});

export default router;
