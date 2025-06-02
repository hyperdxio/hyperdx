import express from 'express';
import { serializeError } from 'serialize-error';
import { z } from 'zod';
import { validateRequest } from 'zod-express-middleware';

import * as config from '@/config';
import {
  generateAlertSilenceToken,
  silenceAlertByToken,
} from '@/controllers/alerts';
import { createTeam, isTeamExisting } from '@/controllers/team';
import { handleAuthError, redirectToDashboard } from '@/middleware/auth';
import TeamInvite from '@/models/teamInvite';
import User from '@/models/user'; // TODO -> do not import model directly
import { setupTeamDefaults } from '@/setupDefaults';
import logger from '@/utils/logger';
import passport from '@/utils/passport';
import { validatePassword } from '@/utils/validators';

const registrationSchema = z
  .object({
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
        pass => /[!@#$%^&*(),.?":{}|<>;\-+=]/.test(pass),
        'Password must include at least one special character',
      ),
    confirmPassword: z.string(),
  })
  .refine(data => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ['confirmPassword'],
  });

const router = express.Router();

router.get('/health', async (req, res) => {
  res.send({
    data: 'OK',
    version: config.CODE_VERSION,
    ip: req.ip,
    env: config.NODE_ENV,
  });
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
            collectorAuthenticationEnforced: true,
          });
          user.team = team._id;
          user.name = email;
          await user.save();

          // Set up default connections and sources for this new team
          try {
            await setupTeamDefaults(team._id.toString());
          } catch (error) {
            logger.error(
              `Failed to setup team defaults: ${serializeError(error)}`,
            );
            // Continue with registration even if setup defaults fails
          }

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

router.get('/logout', (req, res, next) => {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    res.redirect(`${config.FRONTEND_URL}/login`);
  });
});

// TODO: rename this ?
router.post('/team/setup/:token', async (req, res, next) => {
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

router.get('/ext/silence-alert/:token', async (req, res) => {
  let isError = false;

  try {
    const token = req.params.token;
    await silenceAlertByToken(token);
  } catch (e) {
    isError = true;
    logger.error(e);
  }

  // TODO: Create a template for utility pages
  return res.send(`
  <html>
    <head>
      <title>HyperDX</title>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.classless.min.css" />
    </head>
    <body>
      <header>
        <img src="https://www.hyperdx.io/Icon32.png" />
      </header>
      <main>
        ${
          isError
            ? '<p><strong>Link is invalid or expired.</strong> Please try again.</p>'
            : '<p><strong>Alert silenced.</strong> You can close this window now.</p>'
        }
        <a href="${config.FRONTEND_URL}">Back to HyperDX</a>
      </main>
    </body>
  </html>`);
});

export default router;
