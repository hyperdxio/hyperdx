import type { Request, Response, NextFunction } from 'express';

import { serializeError } from 'serialize-error';
import { setTraceAttributes } from '@hyperdx/node-opentelemetry';

import * as config from '../config';
import logger from '../utils/logger';

import type { UserDocument } from '../models/user';

declare global {
  namespace Express {
    interface User extends UserDocument {}
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
      `Password login for user failed, user or team not found ${req?.user?._id}`,
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
  logger.debug({ message: 'Auth error', authErr: serializeError(err) });
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

export function isUserAuthenticated(
  req: Request,
  res: Response,
  next: NextFunction,
) {
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
