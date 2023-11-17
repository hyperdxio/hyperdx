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
import { isUserAuthenticated, redirectToDashboard } from '@/middleware/auth';
import { validatePassword } from '@/utils/validators';

const router = express.Router();

router.post('/', isUserAuthenticated, async (req, res, next) => {
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

router.get('/', isUserAuthenticated, async (req, res, next) => {
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
    });
  } catch (e) {
    next(e);
  }
});

router.patch('/apiKey', isUserAuthenticated, async (req, res, next) => {
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

router.post('/setup/:token', async (req, res, next) => {
  try {
    const { password } = req.body;
    const { token } = req.params;

    if (!validatePassword(password)) {
      return res.redirect(
        `${config.FRONTEND_URL}/join-team?err=invalid&token=${token}`,
      );
    }

    const teamInvite = await TeamInvite.findOne({
      token: req.params.token,
    });
    if (!teamInvite) {
      return res.status(401).send('Invalid token');
    }

    (User as any).register(
      new User({
        email: teamInvite.email,
        name: teamInvite.email,
        team: teamInvite.teamId,
      }),
      password, // TODO: validate password
      async (err: Error, user: any) => {
        if (err) {
          logger.error(serializeError(err));
          return res.redirect(
            `${config.FRONTEND_URL}/join-team?token=${token}&err=500`,
          );
        }

        await TeamInvite.findByIdAndRemove(teamInvite._id);

        req.login(user, err => {
          if (err) {
            return next(err);
          }
          redirectToDashboard(req, res);
        });
      },
    );
  } catch (e) {
    next(e);
  }
});

export default router;
