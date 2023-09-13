import express from 'express';
import isemail from 'isemail';
import { serializeError } from 'serialize-error';

import * as config from '../../config';
import User from '../../models/user'; // TODO -> do not import model directly
import logger from '../../utils/logger';
import passport from '../../utils/passport';
import { Api404Error } from '../../utils/errors';
import { isTeamExisting, createTeam, getTeam } from '../../controllers/team';
import { validatePassword } from '../../utils/validators';
import {
  isUserAuthenticated,
  redirectToDashboard,
  handleAuthError,
} from '../../middleware/auth';

const router = express.Router();

router.get('/health', async (req, res) => {
  res.send({ data: 'OK', version: config.CODE_VERSION, ip: req.ip });
});

router.get('/me', isUserAuthenticated, async (req, res, next) => {
  try {
    if (req.user == null) {
      throw new Api404Error('Request without user found');
    }

    const { _id: id, team: teamId, email, name, createdAt } = req.user;

    const team = await getTeam(teamId);

    return res.json({
      createdAt,
      email,
      id,
      name,
      team,
    });
  } catch (e) {
    next(e);
  }
});

router.get('/installation', async (req, res, next) => {
  try {
    const _isTeamExisting = await isTeamExisting();
    return res.json({
      isTeamExisting: _isTeamExisting,
    });
  } catch (e) {
    next(e);
  }
});

router.post(
  '/login/password',
  passport.authenticate('local', {
    failWithError: true,
    failureMessage: true,
  }),
  redirectToDashboard,
  handleAuthError,
);

router.post('/register/password', async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.redirect(`${config.FRONTEND_URL}/register?err=missing`);
    }

    if (!isemail.validate(email) || !validatePassword(password)) {
      return res.redirect(`${config.FRONTEND_URL}/register?err=invalid`);
    }

    if (await isTeamExisting()) {
      return res.redirect(
        `${config.FRONTEND_URL}/register?err=teamAlreadyExists`,
      );
    }

    (User as any).register(
      new User({ email }),
      password,
      async (err: Error, user: any) => {
        if (err) {
          logger.error(serializeError(err));
          return res.redirect(`${config.FRONTEND_URL}/register?err=invalid`);
        }

        const team = await createTeam({
          name: `${email}'s Team`,
        });
        user.team = team._id;
        user.name = email;
        await user.save();

        return passport.authenticate('local')(req, res, () => {
          redirectToDashboard(req, res);
        });
      },
    );
  } catch (e) {
    next(e);
  }
});

router.get('/logout', (req, res) => {
  // @ts-ignore
  req.logout();
  res.redirect(`${config.FRONTEND_URL}/login`);
});

export default router;
