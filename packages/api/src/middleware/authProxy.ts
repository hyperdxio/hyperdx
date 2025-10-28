import { setTraceAttributes } from '@hyperdx/node-opentelemetry';
import type { NextFunction, Request, Response } from 'express';
import { serializeError } from 'serialize-error';

import * as config from '@/config';
import { findUserByEmail } from '@/controllers/user';
import Team from '@/models/team';
import User from '@/models/user';
import { setupTeamDefaults } from '@/setupDefaults';
import logger from '@/utils/logger';

/**
 * Validates if the request comes from an allowed proxy IP
 */
function isAllowedProxyIP(req: Request): boolean {
  if (!config.AUTH_PROXY_WHITELIST) {
    return true; // No whitelist = allow all (not recommended for production)
  }

  const allowedIPs = config.AUTH_PROXY_WHITELIST.split(',').map(ip =>
    ip.trim(),
  );
  const clientIP = req.ip || req.socket.remoteAddress || '';

  return allowedIPs.some(
    allowedIP => clientIP === allowedIP || clientIP.startsWith(allowedIP),
  );
}

/**
 * Extracts user identifier from the configured header
 */
function getUserIdentifierFromHeader(req: Request): string | null {
  const headerValue =
    req.headers[config.AUTH_PROXY_HEADER_NAME.toLowerCase()];

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

      // Use a constant team name for all auth proxy users
      const AUTH_PROXY_TEAM_NAME = 'Auth Proxy Team';
      
      // Find or create the shared team
      let team = await Team.findOne({ name: AUTH_PROXY_TEAM_NAME });
      
      if (!team) {
        logger.info('Creating shared auth proxy team');
        team = new Team({
          name: AUTH_PROXY_TEAM_NAME,
          collectorAuthenticationEnforced: true,
        });
        await team.save();
        
        // Set up default connections and sources for the new team
        try {
          await setupTeamDefaults(team._id.toString());
        } catch (error) {
          logger.error(
            { err: serializeError(error) },
            'Failed to setup team defaults for auth proxy team',
          );
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
        logger.error(
          { err, email: userEmail },
          'Failed to establish session',
        );
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

