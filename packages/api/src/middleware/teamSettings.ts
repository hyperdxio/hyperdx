import type { RequestHandler } from 'express';
import type { Types } from 'mongoose';

import { IS_LOCAL_APP_MODE } from '@/config';
import Team from '@/models/team';

export async function canManageTeamSettings(
  teamId: string | Types.ObjectId | undefined,
  userId: string | Types.ObjectId | undefined,
): Promise<boolean> {
  if (IS_LOCAL_APP_MODE) return true;
  if (!teamId || !userId) return false;
  const team = await Team.findById(teamId).select('settingsAdminIds');
  if (!team) return false;
  // An absent policy preserves upstream behavior; an empty policy grants nobody.
  return (
    team.settingsAdminIds === undefined ||
    team.settingsAdminIds.some(id => id.toString() === userId.toString())
  );
}

export const requireTeamSettingsAccess: RequestHandler = async (
  req,
  res,
  next,
) => {
  try {
    if (!(await canManageTeamSettings(req.user?.team, req.user?._id))) {
      res.sendStatus(403);
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
};

export const requireTeamSettingsWriteAccess: RequestHandler = (
  req,
  res,
  next,
) => {
  // Source/connection catalogs and webhook choices are needed outside settings.
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  return requireTeamSettingsAccess(req, res, next);
};
