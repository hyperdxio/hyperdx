import express from 'express';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '../../config';
import User from '../../models/user'; // TODO -> do not import model directly
import logger from '../../utils/logger';
import passport from '../../utils/passport';
import { Api404Error } from '../../utils/errors';
import { isTeamExisting, createTeam, getTeam } from '../../controllers/team';
import {
  isUserAuthenticated,
  redirectToDashboard,
  handleAuthError,
} from '../../middleware/auth';

const registrationSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(12, 'Password must have at least 12 characters')
    .refine(
      pass => /[a-z]/.test(pass) && /[A-Z]/.test(pass),
      'Password must include both lower and upper case characters',
    )
    .refine(
      pass => /\d/.test(pass),
      'Password must include at least one number',
    )
    .refine(
      pass => /[!@#$%^&*(),.?":{}|<>]/.test(pass),
      'Password must include at least one special character',
    ),
});

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

router.post(
  '/register/password',
  validateRequest({ body: registrationSchema }),
  async (req, res, next) => {
    try {
      const { email, password } = req.body;

      if (await isTeamExisting()) {
        return res.status(409).json({ error: 'teamAlreadyExists' });
      }

      (User as any).register(
        new User({ email }),
        password,
        async (err: Error, user: any) => {
          if (err) {
            logger.error(serializeError(err));
            return res.status(400).json({ error: 'invalid' });
          }

          const team = await createTeam({
            name: `${email}'s Team`,
          });
          user.team = team._id;
          user.name = email;
          await user.save();

          return passport.authenticate('local')(req, res, () => {
            if (req?.user?.team) {
              return res.status(200).json({ status: 'success' });
            }

            logger.error(
              `Password login for user failed, user or team not found ${req?.user?._id}`,
            );
            return res.status(400).json({ error: 'invalid' });
          });
        },
      );
    } catch (e) {
      next(e);
    }
  },
);

router.get('/logout', (req, res) => {
  // @ts-ignore
  req.logout();
  res.redirect(`${config.FRONTEND_URL}/login`);
});

export default router;
