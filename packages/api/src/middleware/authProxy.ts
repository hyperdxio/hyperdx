import { splitAndTrimCSV } from '@hyperdx/common-utils/dist/utils';
import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import type { NextFunction, Request, Response } from 'express';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import { createTeam, getTeam } from '@/controllers/team';
import { findUserByEmail } from '@/controllers/user';
import User from '@/models/user';
import logger from '@/utils/logger';

/**
 * Validates if the request comes from an allowed proxy IP
 */
function isAllowedProxyIP(req: Request): boolean {
  if (!config.AUTH_PROXY_WHITELIST) {
    return false; // No whitelist = reject (security by default)
  }

  const allowedIPs = splitAndTrimCSV(config.AUTH_PROXY_WHITELIST);

  // Extract client IP from x-forwarded-for header or fallback to req.ip
  const forwardedFor = req.headers['x-forwarded-for'];
  const clientIP = forwardedFor
    ? Array.isArray(forwardedFor)
      ? forwardedFor[0]
      : forwardedFor.split(',')[0].trim()
    : req.ip || req.socket.remoteAddress || '';

  return allowedIPs.some(
    allowedIP => clientIP === allowedIP || clientIP.startsWith(allowedIP),
  );
}

/**
 * Extracts user identifier from the configured header
 */
function getUserIdentifierFromHeader(req: Request): string | null {
  const headerValue = req.headers[config.AUTH_PROXY_HEADER_NAME.toLowerCase()];

  if (!headerValue) {
    return null;
  }

  return Array.isArray(headerValue) ? headerValue[0] : headerValue;
}

/**
 * Auth proxy middleware - authenticates users based on headers from trusted proxy
 */
export async function authProxyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!config.AUTH_PROXY_ENABLED) {
    return next();
  }

  // SECURITY: Check if request is from allowed proxy
  if (!isAllowedProxyIP(req)) {
    logger.warn(
      { ip: req.ip, path: req.path },
      'Auth proxy request from unauthorized IP',
    );
    return res.status(407).json({ error: 'Proxy authentication required' });
  }

  // Extract user identifier from header
  const userEmail = getUserIdentifierFromHeader(req);

  if (!userEmail) {
    logger.debug(
      { header: config.AUTH_PROXY_HEADER_NAME },
      'No user identifier in auth proxy header',
    );
    return res.status(401).json({ error: 'Authentication header missing' });
  }

  try {
    // Find or create user
    let user = await findUserByEmail(userEmail);

    if (!user && config.AUTH_PROXY_AUTO_SIGN_UP) {
      logger.info({ email: userEmail }, 'Auto-creating user via auth proxy');

      // Get or create the single team (app only supports one team)
      let team = await getTeam();

      if (!team) {
        try {
          team = await createTeam({
            name: `${userEmail}'s Team`,
            collectorAuthenticationEnforced: true,
          });
        } catch {
          // If team creation fails (e.g., race condition), try to get it again
          team = await getTeam();
          if (!team) {
            logger.error('Failed to get or create team for auto-provisioning');
            return res.status(500).json({ error: 'Team configuration error' });
          }
        }
      }

      // Create user without password
      user = await (User as any).create({
        email: userEmail,
        name: userEmail,
        team: team._id,
      });
    }

    if (!user) {
      logger.warn(
        { email: userEmail },
        'User not found and auto-signup disabled',
      );
      return res.status(401).json({ error: 'User not found' });
    }

    // Attach user to request
    req.user = user;

    // Set trace attributes
    setTraceAttributes({
      userId: user._id.toString(),
      userEmail: user.email,
    });

    // Establish session (important for subsequent requests)
    req.login(user, err => {
      if (err) {
        logger.error({ err, email: userEmail }, 'Failed to establish session');
        return next(err);
      }
      logger.debug(
        { email: userEmail, userId: user._id },
        'User authenticated via auth proxy',
      );
      next();
    });
  } catch (error) {
    logger.error(
      { error: serializeError(error), email: userEmail },
      'Auth proxy authentication error',
    );
    return res.status(500).json({ error: 'Authentication failed' });
  }
}
