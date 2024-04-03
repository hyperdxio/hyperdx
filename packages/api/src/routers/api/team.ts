import crypto from 'crypto';
import express from 'express';
import isemail from 'isemail';
import pick from 'lodash/pick';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import { getTags, getTeam, rotateTeamApiKey } from '@/controllers/team';
import { findUserByEmail, findUsersByTeam } from '@/controllers/user';
import TeamInvite from '@/models/teamInvite';
import logger from '@/utils/logger';

const router = express.Router();

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

    res.json({
      ...pick(team.toJSON(), [
        '_id',
        'allowedAuthMethods',
        'apiKey',
        'archive',
        'name',
        'slackAlert',
      ]),
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

router.get('/invitations', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    const teamInvites = await TeamInvite.find({ teamId });

    res.json({
      data: teamInvites.map(ti => ({
        createdAt: ti.createdAt,
        email: ti.email,
        name: ti.name,
        url: `${config.FRONTEND_URL}/join-team?token=${ti.token}`,
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/members', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    const teamUsers = await findUsersByTeam(teamId);

    res.json({
      data: teamUsers.map(user => ({
        ...pick(user.toJSON({ virtuals: true }), [
          'email',
          'name',
          'hasPasswordAuth',
        ]),
      })),
    });
  } catch (e) {
    next(e);
  }
});

router.get('/tags', async (req, res, next) => {
  try {
    const teamId = req.user?.team;
    if (teamId == null) {
      throw new Error(`User ${req.user?._id} not associated with a team`);
    }

    const tags = await getTags(teamId);
    return res.json({ data: tags });
  } catch (e) {
    next(e);
  }
});

export default router;
