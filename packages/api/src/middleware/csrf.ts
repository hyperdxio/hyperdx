import { doubleCsrf } from 'csrf-csrf';
import { NextFunction, Request, Response } from 'express';

const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
  getSecret: () => process.env.EXPRESS_SESSION_SECRET || 'fallback-secret',
  getSessionIdentifier: req => req.session?.id || 'anonymous',
  cookieName: '__csrf',
  cookieOptions: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24,
  },
  size: 64,
  ignoredMethods: ['GET', 'HEAD', 'OPTIONS'],
});

export interface CSRFRequest extends Request {
  csrfToken?: () => string;
}

const shouldSkipCsrf = (path: string): boolean => {
  if (path.startsWith('/api/v1')) return true;
  if (path.includes('/webhook')) return true;
  if (path.startsWith('/heroku')) return true;
  if (path.startsWith('/clickhouse-proxy')) return true;

  const authRoutes = ['/login', '/logout', '/register', '/password-reset'];
  return authRoutes.some(route => path.includes(route));
};

export const csrfToken = (
  req: CSRFRequest,
  res: Response,
  next: NextFunction,
) => {
  req.csrfToken = () => generateCsrfToken(req, res);

  if (!shouldSkipCsrf(req.path)) {
    const token = req.csrfToken();
    res.setHeader('X-CSRF-Token', token);
  }

  next();
};

export const csrfProtection = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (shouldSkipCsrf(req.path)) {
    return next();
  }

  doubleCsrfProtection(req, res, next);
};

export { generateCsrfToken };
