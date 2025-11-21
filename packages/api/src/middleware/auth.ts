import { Connection } from '@hyperdx/common-utils/dist/types';
import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import type { NextFunction, Request, Response } from 'express';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import { findUserByAccessKey } from '@/controllers/user';
import type { UserDocument } from '@/models/user';
import logger from '@/utils/logger';

declare global {
  namespace Express {
    interface User extends UserDocument {}
  }
  namespace Express {
    interface Request {
      _hdx_connection?: Connection;
    }
  }
}

declare module 'express-session' {
  interface Session {
    messages: string[]; // Set by passport
    passport: { user: string }; // Set by passport
  }
}

export function redirectToDashboard(req: Request, res: Response) {
  if (req?.user?.team) {
    return res.redirect(`${config.FRONTEND_URL}/search`);
  } else {
    logger.error(
      { userId: req?.user?._id },
      'Password login for user failed, user or team not found',
    );
    res.redirect(`${config.FRONTEND_URL}/login?err=unknown`);
  }
}

export function handleAuthError(
  err: any,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  logger.debug({ authErr: serializeError(err) }, 'Auth error');
  if (res.headersSent) {
    return next(err);
  }

  // Get the latest auth error message
  const lastMessage = req.session.messages?.at(-1);
  logger.debug(`Auth error last message: ${lastMessage}`);

  const returnErr =
    lastMessage === 'Password or username is incorrect'
      ? 'authFail'
      : lastMessage ===
          'Authentication method password is not allowed by your team admin.'
        ? 'passwordAuthNotAllowed'
        : 'unknown';

  res.redirect(`${config.FRONTEND_URL}/login?err=${returnErr}`);
}

export async function validateUserAccessKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.sendStatus(401);
  }
  const key = authHeader.split('Bearer ')[1];
  if (!key) {
    return res.sendStatus(401);
  }

  const user = await findUserByAccessKey(key);
  if (!user) {
    return res.sendStatus(401);
  }

  req.user = user;

  next();
}

export function isUserAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (config.IS_LOCAL_APP_MODE) {
    // If local app mode is enabled, skip authentication
    logger.warn('Skipping authentication in local app mode');
    req.user = {
      // @ts-ignore
      _id: '_local_user_',
      email: 'local-user@hyperdx.io',
      // @ts-ignore
      team: '_local_team_',
    };
    return next();
  }

  if (req.isAuthenticated()) {
    // set user id as trace attribute
    setTraceAttributes({
      userId: req.user?._id.toString(),
      userEmail: req.user?.email,
    });

    return next();
  }
  res.sendStatus(401);
}

export function getNonNullUserWithTeam(req: Request) {
  const user = req.user;

  if (!user) {
    throw new Error('User is not authenticated');
  }

  if (!user.team) {
    throw new Error(`User ${user._id} is not associated with a team`);
  }

  return { teamId: user.team, userId: user._id, email: user.email };
}
