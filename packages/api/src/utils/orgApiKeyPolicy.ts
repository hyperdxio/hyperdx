import type { NextFunction, Request, Response } from 'express';

// Permission checks for org API keys. OSS has no roles, so every team member
// counts as an admin; EE replaces both functions with its RBAC checks.

export function canManageOrgApiKeys(user: Express.User): boolean {
  return user.team != null;
}

function isAdminRequest(req: Request): boolean {
  return req.orgApiKey == null || req.orgApiKey.scope === 'admin';
}

export function requireAdminRequest(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (!isAdminRequest(req)) {
    return res
      .status(403)
      .json({ message: 'This API key does not have admin scope' });
  }
  next();
}
